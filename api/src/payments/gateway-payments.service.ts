import { Injectable, Logger } from '@nestjs/common';
import { type GatewayAccount, type GatewayPayment, type GatewayPaymentStatus, Prisma } from '@prisma/client';
import { AppError, Errors } from '../common/errors';
import { formatNumber } from '../common/format';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { lockOrder } from '../orders/order-ops';
import { OrdersService } from '../orders/orders.service';
import { isOnSale } from '../orders/reservation.service';
import { ParticipantsService } from '../participants/participants.service';
import type { OrgContext } from '../tenancy/org-context';
import { GatewayAccountsService } from './gateway-accounts.service';
import type { ListOnlinePaymentsQuery, PayOrderInput } from './payments.dto';
import { verifyEvent } from './wompi/signatures';
import type { CreateTransactionInput, WompiEvent, WompiPaymentMethod, WompiStatus, WompiTransaction } from './wompi/types';
import { WompiClient } from './wompi/wompi.client';

const STATUS: Record<WompiStatus, GatewayPaymentStatus> = {
  PENDING: 'pending',
  APPROVED: 'approved',
  DECLINED: 'declined',
  VOIDED: 'voided',
  ERROR: 'error',
};

/** Pasado este tiempo sin respuesta de la pasarela, el pago se da por fallido. */
const GIVE_UP_AFTER_MS = 24 * 3_600_000;
/** Mientras el pago esté en curso, lo consultado hace menos de esto no se vuelve a consultar. */
const POLL_THROTTLE_MS = 3_000;

export interface SettleResult {
  applied: boolean;
  reason?: string;
  /** Planes: la suscripción creada o renovada por este pago. La enlaza `apply`, que es quien tiene la fila bloqueada. */
  subscriptionId?: string;
}

/** Quien reacciona a un pago que llegó a su estado final (planes, etc.). Las boletas las maneja este servicio. */
export type SettledHandler = (payment: GatewayPayment, status: GatewayPaymentStatus, tx: WompiTransaction) => Promise<SettleResult>;

/** Lo único que ve el participante de un pago. */
export function presentPayment(p: GatewayPayment) {
  return {
    id: p.id,
    status: p.status,
    method: p.method,
    amountCop: p.amountCop,
    message: p.statusMessage,
    // Solo mientras esté en curso: PSE y Bancolombia mandan al participante a la página del banco.
    redirectUrl: p.status === 'pending' ? p.redirectUrl : null,
    final: p.status !== 'pending',
  };
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

/**
 * Pagos en línea de las boletas. El participante paga en el checkout de Rifa Star (nunca sale de
 * la página, salvo PSE y Bancolombia, que lo llevan a su banco) y Wompi procesa por detrás.
 *
 * Garantías:
 *  - La referencia que se envía a Wompi es el id del pago: un evento nunca se aplica a otra orden.
 *  - El resultado de un pago se procesa una sola vez (fila bloqueada) y se confirma consultando
 *    a Wompi: el cuerpo de un webhook no se toma como verdad.
 *  - Un pago aprobado que no se puede aplicar (números ya vendidos, sorteo jugado) queda marcado
 *    para reembolso; nunca se pierde en silencio.
 */
@Injectable()
export class GatewayPaymentsService {
  private readonly logger = new Logger(GatewayPaymentsService.name);
  private readonly handlers = new Map<string, SettledHandler>();

  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: GatewayAccountsService,
    private readonly wompi: WompiClient,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  /** Otro módulo (planes) registra aquí lo que hace cuando un pago suyo se resuelve. */
  onSettled(purpose: 'subscription', handler: SettledHandler): void {
    this.handlers.set(purpose, handler);
  }

  // ---------------------------------------------------------------------------
  // Checkout público
  // ---------------------------------------------------------------------------

  private activeAccount(tx: { gatewayAccount: { findFirst: (a: object) => Promise<GatewayAccount | null> } }) {
    return tx.gatewayAccount.findFirst({ where: { provider: 'wompi', isActive: true, verifiedAt: { not: null } } });
  }

  /** Qué puede hacer el participante para pagar esta orden en línea. */
  async options(organizationId: string, orderId: string) {
    const { order, account, pending, last } = await this.db.tenantTx(organizationId, async (tx) => {
      const order = await tx.order.findFirst({ where: { id: orderId }, include: { raffle: true } });
      if (!order) throw Errors.notFound('la orden');
      return {
        order,
        account: await this.activeAccount(tx),
        pending: await tx.gatewayPayment.findFirst({ where: { orderId, status: 'pending' } }),
        last: await tx.gatewayPayment.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } }),
      };
    });
    const payable = order.status === 'reserved' && (pending !== null || (order.reservedUntil > new Date() && isOnSale(order.raffle)));
    if (!account || !payable) return { enabled: false as const, payment: last ? presentPayment(last) : null };
    const merchant = await this.wompi.merchant(account.environment, account.publicKey);
    return {
      enabled: true as const,
      environment: account.environment,
      publicKey: account.publicKey,
      /** Base de la API de Wompi a la que el navegador envía la tarjeta para tokenizarla. */
      tokenizeUrl: this.wompi.baseUrl(account.environment),
      methods: account.methods,
      amountCop: order.totalCop,
      contracts: { terms: merchant.acceptance.permalink, personalData: merchant.personalData.permalink },
      payment: last ? presentPayment(last) : null,
    };
  }

  async banks(organizationId: string) {
    const account = await this.db.tenantTx(organizationId, (tx) => this.activeAccount(tx));
    if (!account || !account.methods.includes('PSE')) throw Errors.conflict('GATEWAY_METHOD_DISABLED', 'PSE no está disponible para esta organización.');
    return this.wompi.pseBanks(account.environment, account.publicKey);
  }

  /** Crea la transacción en Wompi. Idempotente: si ya hay un pago en curso para la orden, lo devuelve. */
  async pay(organizationId: string, orderId: string, input: PayOrderInput, attempt = 0): Promise<ReturnType<typeof presentPayment>> {
    const prepared = await this.db
      .tenantTx(organizationId, async (tx) => {
        if (!(await lockOrder(tx, orderId))) throw Errors.notFound('la orden');
        const order = await tx.order.findFirst({
          where: { id: orderId },
          include: { raffle: true, participant: true, organization: { select: { slug: true } } },
        });
        if (!order) throw Errors.notFound('la orden');
        const account = await this.activeAccount(tx);
        if (!account) throw Errors.conflict('GATEWAY_NOT_CONFIGURED', 'Esta organización no recibe pagos en línea.');
        if (!account.methods.includes(input.method)) throw Errors.validation({ field: 'method' }, 'Ese medio de pago no está disponible.');
        const pending = await tx.gatewayPayment.findFirst({ where: { orderId, status: 'pending' } });
        if (pending) return { existing: pending, account, order };
        if (order.status === 'approved') throw Errors.conflict('ORDER_ALREADY_PAID', 'Esta orden ya está pagada.');
        if (order.status !== 'reserved') throw Errors.conflict('ORDER_INVALID_STATE', 'Esta orden ya no admite pagos. Vuelve a elegir tus números.');
        if (order.reservedUntil <= new Date()) throw Errors.conflict('ORDER_EXPIRED', 'Tu apartado venció y los números se liberaron. Vuelve a elegirlos.');
        if (!isOnSale(order.raffle)) throw Errors.conflict('RAFFLE_NOT_ON_SALE', 'La venta de este sorteo ya cerró.');
        const payment = await tx.gatewayPayment.create({
          data: {
            organizationId,
            environment: account.environment,
            purpose: 'order',
            gatewayAccountId: account.id,
            orderId,
            method: input.method,
            amountCop: order.totalCop,
            customerEmail: input.email,
          },
        });
        return { payment, account, order };
      })
      .catch(async (err) => {
        // Dos clics a la vez: el índice único deja pasar uno; el otro recibe el pago del primero.
        if (isUniqueViolation(err) && attempt < 2) return null;
        throw err;
      });
    if (!prepared) return this.pay(organizationId, orderId, input, attempt + 1);

    if ('existing' in prepared && prepared.existing) {
      const current = await this.refresh(prepared.existing.id);
      if (current && current.status === 'pending') return presentPayment(current);
      if (attempt < 2) return this.pay(organizationId, orderId, input, attempt + 1);
      throw Errors.conflict('ORDER_INVALID_STATE', 'Esta orden ya no admite pagos.');
    }

    const { payment, account, order } = prepared as { payment: GatewayPayment; account: GatewayAccount; order: NonNullable<Awaited<ReturnType<GatewayPaymentsService['loadOrder']>>> };
    const creds = this.accounts.toCredentials(account);
    try {
      const merchant = await this.wompi.merchant(creds.environment, creds.publicKey);
      const tx = await this.wompi.createTransaction(creds, {
        reference: payment.id,
        amountInCents: payment.amountCop * 100,
        customerEmail: input.email,
        acceptanceToken: merchant.acceptance.token,
        acceptPersonalAuth: merchant.personalData.token,
        // Vuelta del banco (PSE / Bancolombia): la misma página de pago, que consulta el resultado.
        redirectUrl: `${env().PUBLIC_BASE_URL.replace(/\/+$/, '')}/${order.organization.slug}/${order.raffle.slug}/pagar?pago=${payment.id}`,
        ...(input.method === 'PSE' && {
          customerData: { fullName: order.participant.name, phoneNumber: order.participant.phone.replace(/\D/g, '') },
        }),
        paymentMethod: this.paymentMethod(input, order.raffle.title),
      } satisfies CreateTransactionInput);
      const saved = await this.db.system.gatewayPayment.update({
        where: { id: payment.id },
        // Sin `lastCheckedAt`: crear el cobro no es consultarlo, y la primera consulta no debe esperar.
        data: { externalId: tx.id, redirectUrl: tx.asyncPaymentUrl, statusMessage: tx.statusMessage },
      });
      // Casi siempre nace PENDING; si Wompi ya lo resolvió, se aplica ahora.
      if (STATUS[tx.status] !== 'pending') return presentPayment(await this.apply(saved.id, tx));
      return presentPayment(saved);
    } catch (err) {
      await this.markFailed(payment.id, err instanceof AppError ? err.message : 'No se pudo iniciar el pago.');
      throw err;
    }
  }

  private loadOrder(tx: Parameters<Parameters<DatabaseService['tenantTx']>[1]>[0], orderId: string) {
    return tx.order.findFirst({ where: { id: orderId }, include: { raffle: true, participant: true, organization: { select: { slug: true } } } });
  }

  private paymentMethod(input: PayOrderInput, raffleTitle: string): WompiPaymentMethod {
    // Wompi limita la descripción: 30 caracteres en el sandbox de PSE, 64 en producción.
    const description = `Boletas ${raffleTitle}`.slice(0, 30);
    switch (input.method) {
      case 'CARD':
        return { type: 'CARD', token: input.cardToken!, installments: input.installments };
      case 'NEQUI':
        return { type: 'NEQUI', phoneNumber: input.phone!.replace(/\D/g, '').slice(-10) };
      case 'PSE':
        return { type: 'PSE', userType: input.pse!.userType, legalIdType: input.pse!.legalIdType, legalId: input.pse!.legalId, bankCode: input.pse!.bankCode, description };
      case 'BANCOLOMBIA_TRANSFER':
        return { type: 'BANCOLOMBIA_TRANSFER', description };
    }
  }

  /** El pago no llegó a existir en Wompi (error al crearlo): queda como fallido y la orden puede reintentar. */
  async markFailed(paymentId: string, message: string): Promise<void> {
    await this.db.system.gatewayPayment.updateMany({
      where: { id: paymentId, status: 'pending' },
      data: { status: 'error', statusMessage: message.slice(0, 300), finalizedAt: new Date() },
    });
  }

  /** Estado del último pago de la orden; mientras esté en curso, lo confirma con Wompi. */
  async status(organizationId: string, orderId: string) {
    let payment = await this.db.tenantTx(organizationId, (tx) => tx.gatewayPayment.findFirst({ where: { orderId }, orderBy: { createdAt: 'desc' } }));
    if (!payment) return { payment: null };
    if (payment.status === 'pending' && (!payment.lastCheckedAt || Date.now() - payment.lastCheckedAt.getTime() > POLL_THROTTLE_MS)) {
      payment = (await this.refresh(payment.id)) ?? payment;
    }
    return { payment: presentPayment(payment) };
  }

  // ---------------------------------------------------------------------------
  // Resultado: webhook, consulta y conciliación
  // ---------------------------------------------------------------------------

  /** Consulta a Wompi y aplica el resultado. Seguro de llamar varias veces. */
  async refresh(paymentId: string): Promise<GatewayPayment | null> {
    const p = await this.db.system.gatewayPayment.findUnique({ where: { id: paymentId } });
    if (!p || p.status !== 'pending') return p;
    if (!p.externalId) {
      // Nunca llegó a crearse en Wompi (la API se cayó a mitad). Si ya pasó un rato, se descarta.
      if (Date.now() - p.createdAt.getTime() > 5 * 60_000) await this.markFailed(p.id, 'El pago no se pudo iniciar.');
      return this.db.system.gatewayPayment.findUnique({ where: { id: paymentId } });
    }
    const creds = p.gatewayAccountId ? await this.accounts.credentials(p.gatewayAccountId) : this.accounts.platformCredentials();
    const tx = await this.wompi.getTransaction(creds, p.externalId);
    return this.apply(p.id, tx);
  }

  /**
   * Aplica el estado de una transacción a su pago. Procesa una sola vez: la fila del pago se
   * bloquea y, si ya no está en curso, no se hace nada.
   */
  async apply(paymentId: string, tx: WompiTransaction): Promise<GatewayPayment> {
    const next = STATUS[tx.status];
    return this.db.system.$transaction(
      async (sys) => {
        const locked = await sys.$queryRaw<{ id: string }[]>`SELECT id FROM gateway_payments WHERE id = ${paymentId}::uuid FOR UPDATE`;
        if (locked.length === 0) throw Errors.notFound('el pago');
        const p = await sys.gatewayPayment.findUniqueOrThrow({ where: { id: paymentId } });
        if (p.status !== 'pending') return p;
        if (next === 'pending') {
          return sys.gatewayPayment.update({
            where: { id: p.id },
            data: { lastCheckedAt: new Date(), externalId: p.externalId ?? tx.id, redirectUrl: tx.asyncPaymentUrl ?? p.redirectUrl },
          });
        }

        let status: GatewayPaymentStatus = next;
        let message = tx.statusMessage;
        let refundRequired = false;
        let subscriptionId: string | undefined;
        if (next === 'approved' && (tx.reference !== p.id || tx.amountInCents !== p.amountCop * 100)) {
          // Dinero cobrado que no corresponde a este pago: no se aplica y se marca para revisión.
          status = 'error';
          refundRequired = true;
          message = 'El monto o la referencia del pago aprobado no coinciden con la orden.';
        } else {
          const result = await this.dispatch(p, next, tx);
          subscriptionId = result.subscriptionId;
          if (next === 'approved' && !result.applied) {
            refundRequired = true;
            message = result.reason ?? 'El pago se aprobó pero no se pudo aplicar.';
          }
        }
        const updated = await sys.gatewayPayment.update({
          where: { id: p.id },
          data: {
            status,
            statusMessage: message?.slice(0, 300) ?? null,
            refundRequired,
            externalId: p.externalId ?? tx.id,
            redirectUrl: null,
            lastCheckedAt: new Date(),
            finalizedAt: new Date(),
            ...(subscriptionId && { subscriptionId }),
          },
        });
        if (refundRequired) {
          this.logger.warn(`Pago ${p.id} aprobado en Wompi pero no aplicado: requiere reembolso (${message})`);
          await this.audit.recordSystem(
            {
              action: 'gateway.refund_required',
              entityType: 'gateway_payment',
              entityId: p.id,
              organizationId: p.organizationId,
              after: { orderId: p.orderId, amountCop: p.amountCop, reason: message },
            },
            sys,
          );
        }
        return updated;
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  private async dispatch(p: GatewayPayment, status: GatewayPaymentStatus, tx: WompiTransaction): Promise<SettleResult> {
    if (p.purpose === 'order') {
      // Solo la aprobación cambia la orden: si el pago falla, la orden sigue apartada y puede reintentar.
      if (status !== 'approved') return { applied: true };
      return this.orders.approveFromGateway(p.organizationId, p.orderId!, p.id);
    }
    const handler = this.handlers.get(p.purpose);
    return handler ? handler(p, status, tx) : { applied: true };
  }

  /**
   * Webhook de Wompi. `accountId` null = cuenta de Rifa Star (planes). Devuelve true si el evento
   * era nuevo. Firma inválida → 401; referencia desconocida → se guarda y se responde 200 (Wompi
   * no debe reintentar algo que nunca va a encontrar).
   */
  async handleEvent(accountId: string | null, event: WompiEvent): Promise<{ duplicate: boolean }> {
    const creds = accountId ? await this.accounts.credentials(accountId).catch(() => null) : this.accounts.platformCredentials();
    if (!creds || !verifyEvent(event, creds.eventsSecret)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 401, 'Firma del webhook inválida.');
    }
    const rows = await this.db.system.$queryRaw<{ id: string }[]>`
      INSERT INTO gateway_events (id, provider, gateway_account_id, external_event_id, type, payload, received_at)
      VALUES (gen_random_uuid(), 'wompi'::"GatewayProvider", ${accountId}::uuid, ${event.signature.checksum.toUpperCase()},
              ${event.event}, ${JSON.stringify(event)}::jsonb, now())
      ON CONFLICT (provider, external_event_id) DO NOTHING
      RETURNING id`;
    const eventId = rows[0]?.id;
    if (!eventId) return { duplicate: true };
    if (accountId) await this.db.system.gatewayAccount.update({ where: { id: accountId }, data: { lastEventAt: new Date() } });
    if (event.event !== 'transaction.updated') {
      await this.db.system.gatewayEvent.update({ where: { id: eventId }, data: { processedAt: new Date() } });
      return { duplicate: false };
    }

    const transaction = (event.data as { transaction?: { id?: string; reference?: string } }).transaction;
    const reference = transaction?.reference ?? '';
    const payment = /^[0-9a-f-]{36}$/i.test(reference)
      ? await this.db.system.gatewayPayment.findFirst({ where: { id: reference, gatewayAccountId: accountId } })
      : null;
    try {
      if (!payment) {
        await this.db.system.gatewayEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), lastError: 'Referencia desconocida' } });
        return { duplicate: false };
      }
      // No se confía en el cuerpo: el estado real se consulta a Wompi con la llave privada.
      await this.refresh(payment.id);
      await this.db.system.gatewayEvent.update({ where: { id: eventId }, data: { processedAt: new Date(), lastError: null } });
    } catch (err) {
      await this.db.system.gatewayEvent.update({ where: { id: eventId }, data: { lastError: (err as Error).message.slice(0, 500) } });
      throw err;
    }
    return { duplicate: false };
  }

  /**
   * Red de seguridad por si un webhook se perdió: consulta los pagos que siguen en curso y da por
   * fallidos los que Wompi no resolvió en 24 horas.
   */
  async reconcile(now = new Date()): Promise<number> {
    const pending = await this.db.system.gatewayPayment.findMany({
      where: {
        status: 'pending',
        createdAt: { lt: new Date(now.getTime() - 20_000) },
        OR: [{ lastCheckedAt: null }, { lastCheckedAt: { lt: new Date(now.getTime() - 30_000) } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });
    let resolved = 0;
    for (const p of pending) {
      try {
        const current = await this.refresh(p.id);
        if (current && current.status !== 'pending') resolved++;
        else if (now.getTime() - p.createdAt.getTime() > GIVE_UP_AFTER_MS) {
          await this.apply(p.id, {
            id: p.externalId ?? '',
            reference: p.id,
            status: 'ERROR',
            statusMessage: 'La pasarela no confirmó el pago.',
            amountInCents: p.amountCop * 100,
            currency: 'COP',
            paymentMethodType: p.method,
            asyncPaymentUrl: null,
          });
          resolved++;
        }
      } catch (err) {
        this.logger.error(`Conciliación del pago ${p.id}: ${(err as Error).message}`);
      }
    }
    return resolved;
  }

  // ---------------------------------------------------------------------------
  // Panel de la organización
  // ---------------------------------------------------------------------------

  async list(org: OrgContext, query: ListOnlinePaymentsQuery) {
    return this.db.tenantTx(org.id, async (tx) => {
      const rows = await tx.gatewayPayment.findMany({
        where: { purpose: 'order', ...(query.status && { status: query.status }), ...(query.refundRequired && { refundRequired: true }) },
        orderBy: { createdAt: 'desc' },
        take: query.limit,
        include: { order: { include: { participant: { select: { name: true, phone: true } }, raffle: { select: { title: true, digits: true } } } } },
      });
      const refunds = await tx.gatewayPayment.count({ where: { purpose: 'order', refundRequired: true } });
      return {
        refundsPending: refunds,
        items: rows.map((p) => ({
          id: p.id,
          status: p.status,
          method: p.method,
          amountCop: p.amountCop,
          message: p.statusMessage,
          refundRequired: p.refundRequired,
          environment: p.environment,
          externalId: p.externalId,
          createdAt: p.createdAt,
          finalizedAt: p.finalizedAt,
          order: p.order && {
            id: p.order.id,
            status: p.order.status,
            raffle: p.order.raffle.title,
            numbers: p.order.numbers.map((n) => formatNumber(n, p.order!.raffle.digits)),
          },
          participant: p.order && { name: p.order.participant.name, phone: ParticipantsService.phoneFor(org, p.order.participant.phone) },
        })),
      };
    });
  }

  /** El organizador ya devolvió el dinero (desde su panel de Wompi): se limpia el aviso. */
  async markRefunded(org: OrgContext, id: string, note: string) {
    await this.db.tenantTx(org.id, async (tx) => {
      const p = await tx.gatewayPayment.findFirst({ where: { id, refundRequired: true } });
      if (!p) throw Errors.notFound('un pago pendiente de reembolso');
      await tx.gatewayPayment.update({ where: { id }, data: { refundRequired: false, statusMessage: `Reembolsado: ${note}`.slice(0, 300) } });
      await this.audit.record(tx, { action: 'gateway.refund_done', entityType: 'gateway_payment', entityId: id, after: { note, amountCop: p.amountCop } });
    });
    return { ok: true };
  }
}
