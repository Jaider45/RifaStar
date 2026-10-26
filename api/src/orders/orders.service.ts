import { Injectable } from '@nestjs/common';
import { type Order, type Participant, Prisma, type Raffle, type Ticket } from '@prisma/client';
import { Errors } from '../common/errors';
import { formatNumber, ticketCode } from '../common/format';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import { ParticipantsService } from '../participants/participants.service';
import { presentPaymentAccount } from '../payment-accounts/payment-accounts';
import { SettingsService } from '../settings/settings.service';
import { MB, RECEIPT_TYPES } from '../storage/file-type';
import { StorageProvider } from '../storage/storage.provider';
import { type UploadPolicy, UploadsService } from '../storage/uploads.service';
import type { OrgContext } from '../tenancy/org-context';
import { lockOrder, releaseHeldNumbers, releasePaidNumbers } from './order-ops';
import { type OrderEvent, OrderHooks } from './order-hooks';
import type { ListOrdersQuery, SalesQuery } from './orders.dto';
import { isOnSale } from './reservation.service';

type OrderFull = Order & {
  raffle: Raffle;
  participant: Participant;
  tickets: Ticket[];
  seller?: { id: string; user: { name: string } } | null;
};

const invalidState = (message = 'Esta orden ya fue procesada.') => Errors.conflict('ORDER_INVALID_STATE', message);

const STATUS_LABELS: Record<Order['status'], string> = {
  reserved: 'Apartado',
  pending_verification: 'Por verificar',
  approved: 'Pagado',
  rejected: 'Rechazado',
  expired: 'Vencido',
  released: 'Liberado',
};

@Injectable()
export class OrdersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly storage: StorageProvider,
    private readonly settings: SettingsService,
    private readonly hooks: OrderHooks,
  ) {}

  // ---------------------------------------------------------------------------
  // Panel
  // ---------------------------------------------------------------------------

  private present(org: OrgContext, o: OrderFull) {
    return {
      id: o.id,
      status: o.status,
      statusLabel: STATUS_LABELS[o.status],
      raffle: { id: o.raffle.id, title: o.raffle.title, digits: o.raffle.digits },
      participant: { id: o.participant.id, name: o.participant.name, phone: ParticipantsService.phoneFor(org, o.participant.phone) },
      numbers: o.numbers.map((n) => formatNumber(n, o.raffle.digits)),
      numbersRaw: o.numbers,
      unitPrice: o.unitPrice,
      totalCop: o.totalCop,
      reservedUntil: o.reservedUntil,
      receipt: o.receiptKey ? { uploadedAt: o.receiptUploadedAt, mime: o.receiptMime, size: o.receiptSize } : null,
      sellerCode: o.sellerCode,
      createdAt: o.createdAt,
      verifiedAt: o.verifiedAt,
      rejectionReason: o.rejectionReason,
      releasedAt: o.releasedAt,
      releaseReason: o.releaseReason,
      tickets: o.tickets.filter((t) => t.status === 'valid').map((t) => ({ code: t.code, number: formatNumber(t.number, o.raffle.digits) })),
    };
  }

  private include = { raffle: true, participant: true, tickets: true } satisfies Prisma.OrderInclude;

  /**
   * Alertas antifraude para quien verifica: el mismo archivo usado en otra orden, y si la
   * venta es suya (no la puede aprobar: separación de funciones).
   */
  private async alerts(tx: Tx, org: OrgContext, rows: Order[]) {
    const hashes = [...new Set(rows.map((o) => o.receiptSha256).filter((h): h is string => Boolean(h)))];
    const dupes = hashes.length
      ? await tx.order.findMany({
          where: { receiptSha256: { in: hashes } },
          select: { id: true, receiptSha256: true, createdAt: true, status: true, participant: { select: { name: true } }, raffle: { select: { title: true } } },
        })
      : [];
    return (o: Order) => ({
      duplicateReceipt: dupes
        .filter((d) => d.receiptSha256 === o.receiptSha256 && d.id !== o.id)
        .map((d) => ({ orderId: d.id, participantName: d.participant.name, raffle: d.raffle.title, status: d.status, createdAt: d.createdAt })),
      ownSale: Boolean(org.memberId && o.sellerMemberId === org.memberId),
    });
  }

  /** Cola de verificación: los más antiguos primero. */
  queue(org: OrgContext, raffleId?: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const rows = await tx.order.findMany({
        where: { status: 'pending_verification', ...(raffleId && { raffleId }) },
        include: this.include,
        orderBy: [{ receiptUploadedAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 500,
      });
      const alertsFor = await this.alerts(tx, org, rows);
      return rows.map((o) => ({ ...this.present(org, o), alerts: alertsFor(o) }));
    });
  }

  /** Nadie aprueba ni rechaza el pago de una venta atribuida a su propio código. */
  private assertNotOwnSale(org: OrgContext, o: Order) {
    if (org.memberId && o.sellerMemberId === org.memberId) throw Errors.selfApproval();
  }

  list(org: OrgContext, query: ListOrdersQuery) {
    return this.db.tenantTx(org.id, async (tx) => {
      const digits = query.q?.replace(/\D/g, '') ?? '';
      const rows = await tx.order.findMany({
        where: {
          raffleId: query.raffleId,
          status: query.status,
          sellerMemberId: query.sellerMemberId,
          ...(query.q && {
            participant: {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' } },
                ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
              ],
            },
          }),
        },
        include: this.include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      });
      const page = rows.slice(0, query.limit);
      return { items: page.map((o) => this.present(org, o)), nextCursor: rows.length > query.limit ? page[page.length - 1].id : null };
    });
  }

  async detail(org: OrgContext, id: string) {
    const { order, alerts } = await this.db.tenantTx(org.id, async (tx) => {
      const order = await this.findFull(tx, id);
      return { order, alerts: (await this.alerts(tx, org, [order]))(order) };
    });
    return {
      ...this.present(org, order),
      receiptUrl: order.receiptKey ? await this.storage.signedGetUrl(order.receiptKey, 60) : null,
      verifiedBy: order.verifiedById,
      alerts,
    };
  }

  private async findFull(tx: Tx, id: string): Promise<OrderFull> {
    const order = await tx.order.findFirst({ where: { id }, include: this.include });
    if (!order) throw Errors.notFound('la orden');
    return order;
  }

  /**
   * Regla 3: números → paid, tickets, contadores, puntos (hook) y auditoría en
   * una sola transacción. El WhatsApp se encola después del commit.
   */
  async approve(org: OrgContext, id: string) {
    let event!: OrderEvent;
    const order = await this.db.tenantTx(org.id, async (tx) => {
      if (!(await lockOrder(tx, id))) throw Errors.notFound('la orden');
      const o = await this.findFull(tx, id);
      if (o.status !== 'pending_verification' && o.status !== 'reserved') throw invalidState();
      this.assertNotOwnSale(org, o);
      if (!['active', 'sold_out', 'closed'].includes(o.raffle.status)) {
        throw Errors.conflict('RAFFLE_NOT_APPROVABLE', 'El sorteo ya se jugó o fue cancelado: no se pueden aprobar pagos.');
      }
      const now = new Date();
      const paid = await tx.$executeRaw`
        UPDATE raffle_numbers SET status = 'paid', paid_at = ${now}, reserved_until = NULL, updated_at = now()
         WHERE order_id = ${id}::uuid AND status IN ('reserved', 'pending_verification')`;
      if (paid !== o.numbers.length) {
        throw Errors.conflict('ORDER_NUMBERS_MISMATCH', 'Los números de esta orden cambiaron. Recarga e inténtalo de nuevo.');
      }
      await tx.order.update({ where: { id }, data: { status: 'approved', verifiedById: org.memberId, verifiedAt: now } });
      await tx.ticket.createMany({
        data: o.numbers.map((n) => ({
          organizationId: org.id,
          raffleId: o.raffleId,
          orderId: id,
          participantId: o.participantId,
          number: n,
          code: ticketCode(o.raffle.sequence, n, o.raffle.digits),
          issuedAt: now,
        })),
      });
      const [raffle] = await tx.$queryRaw<{ paid_count: number; total_numbers: number; status: string }[]>`
        UPDATE raffles SET paid_count = paid_count + ${paid}, held_count = held_count - ${paid}, updated_at = now()
         WHERE id = ${o.raffleId}::uuid
        RETURNING paid_count, total_numbers, status`;
      if (raffle.paid_count === raffle.total_numbers && raffle.status === 'active') {
        await tx.raffle.update({ where: { id: o.raffleId }, data: { status: 'sold_out' } });
        await this.audit.record(tx, { action: 'raffle.sold_out', entityType: 'raffle', entityId: o.raffleId, after: { status: 'sold_out' } });
      }
      event = this.event('approved', org, o, now);
      await this.hooks.runInTransaction(tx, event);
      await this.audit.record(tx, {
        action: 'order.approve',
        entityType: 'order',
        entityId: id,
        before: { status: o.status },
        after: { status: 'approved', numbers: o.numbers, totalCop: o.totalCop },
      });
      return this.findFull(tx, id);
    });
    await this.hooks.runAfterCommit(event);
    return this.present(org, order);
  }

  /** Rechazo: libera los números y se notifica con el motivo. */
  async reject(org: OrgContext, id: string, reason: string) {
    let event!: OrderEvent;
    const order = await this.db.tenantTx(org.id, async (tx) => {
      if (!(await lockOrder(tx, id))) throw Errors.notFound('la orden');
      const o = await this.findFull(tx, id);
      if (o.status !== 'pending_verification' && o.status !== 'reserved') throw invalidState();
      this.assertNotOwnSale(org, o);
      await tx.order.update({
        where: { id },
        data: { status: 'rejected', rejectionReason: reason, verifiedById: org.memberId, verifiedAt: new Date() },
      });
      await releaseHeldNumbers(tx, [id]);
      event = this.event('rejected', org, o, new Date(), reason);
      await this.hooks.runInTransaction(tx, event);
      await this.audit.record(tx, { action: 'order.reject', entityType: 'order', entityId: id, before: { status: o.status }, after: { status: 'rejected', reason } });
      return this.findFull(tx, id);
    });
    await this.hooks.runAfterCommit(event);
    return this.present(org, order);
  }

  /**
   * Liberar (P9): también una orden aprobada, antes de que haya resultado. Los
   * tickets quedan anulados y el hook del ranking revierte los puntos.
   */
  async release(org: OrgContext, id: string, reason: string) {
    let event!: OrderEvent;
    const order = await this.db.tenantTx(org.id, async (tx) => {
      if (!(await lockOrder(tx, id))) throw Errors.notFound('la orden');
      const o = await this.findFull(tx, id);
      if (!['reserved', 'pending_verification', 'approved'].includes(o.status)) throw invalidState();
      const now = new Date();
      if (o.status === 'approved') {
        const hasResult = await tx.drawResult.count({ where: { raffleId: o.raffleId } });
        if (hasResult || o.raffle.status === 'drawn') {
          throw Errors.conflict('RESULT_ALREADY_ENTERED', 'El resultado del sorteo ya se registró: los números pagados no se pueden liberar.');
        }
        await releasePaidNumbers(tx, id, o.raffleId);
        await tx.ticket.updateMany({ where: { orderId: id, status: 'valid' }, data: { status: 'void', voidedAt: now } });
        if (o.raffle.status === 'sold_out') await tx.raffle.update({ where: { id: o.raffleId }, data: { status: 'active' } });
      } else {
        await releaseHeldNumbers(tx, [id]);
      }
      await tx.order.update({ where: { id }, data: { status: 'released', releasedById: org.memberId, releasedAt: now, releaseReason: reason } });
      event = this.event('released', org, o, now, reason);
      await this.hooks.runInTransaction(tx, event);
      await this.audit.record(tx, { action: 'order.release', entityType: 'order', entityId: id, before: { status: o.status }, after: { status: 'released', reason } });
      return this.findFull(tx, id);
    });
    await this.hooks.runAfterCommit(event);
    return this.present(org, order);
  }

  private event(type: OrderEvent['type'], org: OrgContext, o: Order, at: Date, reason?: string): OrderEvent {
    return {
      type,
      organizationId: org.id,
      orderId: o.id,
      raffleId: o.raffleId,
      participantId: o.participantId,
      numbers: o.numbers,
      previousStatus: o.status,
      reason: reason ?? null,
      actorMemberId: org.memberId,
      at,
    };
  }

  /** Ventas del vendedor con su código (sales.view_own). */
  salesMine(org: OrgContext, query: SalesQuery) {
    return this.db.tenantTx(org.id, async (tx) => {
      if (!org.memberId) return { summary: { orders: 0, approvedOrders: 0, numbersSold: 0, approvedCop: 0 }, items: [] };
      const rows = await tx.order.findMany({
        where: {
          sellerMemberId: org.memberId,
          raffleId: query.raffleId,
          createdAt: { gte: query.from, lte: query.to },
        },
        include: this.include,
        orderBy: { createdAt: 'desc' },
        take: 500,
      });
      const approved = rows.filter((o) => o.status === 'approved');
      return {
        summary: {
          orders: rows.length,
          approvedOrders: approved.length,
          numbersSold: approved.reduce((n, o) => n + o.numbers.length, 0),
          approvedCop: approved.reduce((n, o) => n + o.totalCop, 0),
        },
        // El vendedor no ve el teléfono completo salvo que tenga el permiso.
        items: rows.map((o) => this.present(org, o)),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Público (con el token de la orden)
  // ---------------------------------------------------------------------------

  /**
   * Los métodos públicos reciben la org ya resuelta por PublicOrderAccess (que
   * valida el token de la orden).
   */
  async publicStatus(organizationId: string, orderId: string) {
    return this.db.tenantTx(organizationId, async (tx) => {
      const o = await this.findFull(tx, orderId);
      const payments = await this.settings.read(tx, 'payments');
      const accounts = await tx.paymentAccount.findMany({
        where: { isActive: true, raffles: { some: { raffleId: o.raffleId } } },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      return {
        orderId: o.id,
        status: o.status,
        statusLabel: STATUS_LABELS[o.status],
        numbers: o.numbers.map((n) => formatNumber(n, o.raffle.digits)),
        totalCop: o.totalCop,
        reservedUntil: o.reservedUntil,
        receiptUploaded: Boolean(o.receiptKey),
        requireReceipt: payments.data.requireReceipt,
        rejectionReason: o.rejectionReason,
        tickets: o.tickets.filter((t) => t.status === 'valid').map((t) => ({ code: t.code, number: formatNumber(t.number, o.raffle.digits) })),
        raffle: { slug: o.raffle.slug, title: o.raffle.title, drawAt: o.raffle.drawAt, lottery: o.raffle.lottery },
        paymentAccounts: accounts.map(presentPaymentAccount),
        serverTime: new Date(),
      };
    });
  }

  private receiptPolicy(organizationId: string, orderId: string): UploadPolicy {
    return { prefix: `receipts/${organizationId}/${orderId}/`, allowed: RECEIPT_TYPES, maxBytes: 10 * MB, label: 'el comprobante' };
  }

  /** Se puede subir (o reemplazar) el comprobante mientras la orden esté apartada o en verificación y la venta abierta. */
  private assertCanSubmit(o: Order & { raffle: Raffle }) {
    if (o.status === 'reserved' && o.reservedUntil <= new Date()) {
      throw Errors.conflict('ORDER_EXPIRED', 'Tu apartado venció y los números se liberaron. Vuelve a elegirlos.');
    }
    if (o.status === 'expired') throw Errors.conflict('ORDER_EXPIRED', 'Tu apartado venció y los números se liberaron. Vuelve a elegirlos.');
    if (o.status !== 'reserved' && o.status !== 'pending_verification') throw invalidState();
    if (!isOnSale(o.raffle) && !(o.raffle.status === 'sold_out' && o.status === 'pending_verification')) {
      throw Errors.conflict('RAFFLE_NOT_ON_SALE', 'La venta de este sorteo ya cerró: no se reciben más comprobantes.');
    }
  }

  async receiptUpload(organizationId: string, orderId: string, contentType: string, size: number) {
    await this.db.tenantTx(organizationId, async (tx) => this.assertCanSubmit(await this.findFull(tx, orderId)));
    return this.uploads.presign(this.receiptPolicy(organizationId, orderId), contentType, size);
  }

  /**
   * Confirma el comprobante (o el pago sin comprobante si la org no lo exige):
   * la orden pasa a pending_verification y deja de vencer.
   */
  async receiptConfirm(organizationId: string, orderId: string, key: string | undefined) {
    const file = key ? await this.uploads.verify(this.receiptPolicy(organizationId, orderId), key) : null;
    // Huella del archivo: el panel avisa si el mismo comprobante aparece en otra orden.
    const sha256 = file ? await this.storage.sha256(file.key) : null;
    const previousKey = await this.db.tenantTx(organizationId, async (tx) => {
      if (!(await lockOrder(tx, orderId))) throw Errors.notFound('la orden');
      const o = await this.findFull(tx, orderId);
      this.assertCanSubmit(o);
      if (!file) {
        const payments = await this.settings.read(tx, 'payments');
        if (payments.data.requireReceipt) {
          throw Errors.validation({ field: 'key' }, 'Sube el comprobante de pago para enviarlo a verificación.');
        }
      }
      const now = new Date();
      await tx.order.update({
        where: { id: orderId },
        data: {
          status: 'pending_verification',
          ...(file && { receiptKey: file.key, receiptMime: file.mime, receiptSize: file.size, receiptUploadedAt: now, receiptSha256: sha256 }),
        },
      });
      await tx.$executeRaw`
        UPDATE raffle_numbers SET status = 'pending_verification', reserved_until = NULL, updated_at = now()
         WHERE order_id = ${orderId}::uuid AND status = 'reserved'`;
      await this.audit.record(tx, {
        action: file ? 'order.receipt_uploaded' : 'order.payment_reported',
        entityType: 'order',
        entityId: orderId,
        before: { status: o.status },
        after: { status: 'pending_verification', mime: file?.mime ?? null },
      });
      return o.receiptKey;
    });
    if (previousKey && file && previousKey !== file.key) await this.storage.remove(previousKey).catch(() => undefined);
    return this.publicStatus(organizationId, orderId);
  }
}
