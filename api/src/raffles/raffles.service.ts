import { Injectable } from '@nestjs/common';
import { Prisma, type Prize, type Raffle, type RaffleStatus } from '@prisma/client';
import { AppError, Errors } from '../common/errors';
import { maskPhone } from '../common/phone';
import { slugify } from '../common/slug';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import { SchedulerService } from '../jobs/scheduler.service';
import { NotificationsService } from '../messaging/notifications.service';
import { expireReservedOrders } from '../orders/order-ops';
import { IMAGE_TYPES, MB } from '../storage/file-type';
import { StorageProvider } from '../storage/storage.provider';
import { type UploadPolicy, UploadsService } from '../storage/uploads.service';
import { can, type OrgContext } from '../tenancy/org-context';
import { PageConfig, readPageConfig } from './page-config';
import { prizeRuleLabel, RULES_BY_DIGITS } from './prize-rules';
import {
  extraDigitsIssue,
  type CreateRaffleDto,
  type DuplicateRaffleDto,
  type ListRafflesQuery,
  type MediaKind,
  type PrizeInput,
  type UpdateRaffleDto,
  type UploadRequestDto,
} from './raffles.dto';

type RaffleWithPrizes = Raffle & { prizes: Prize[]; paymentAccounts: { paymentAccountId: string }[] };

/** Estados en los que el sorteo cuenta como «activo» para el plan. */
export const LIVE_STATUSES: RaffleStatus[] = ['active', 'sold_out', 'closed'];
const SELLING: RaffleStatus[] = ['active', 'sold_out'];

const notEditable = () =>
  Errors.conflict('RAFFLE_NOT_EDITABLE', 'Este sorteo ya terminó o fue cancelado y no se puede modificar.');

@Injectable()
export class RafflesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly storage: StorageProvider,
    private readonly scheduler: SchedulerService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Las notificaciones nunca hacen fallar la operación que ya se confirmó. */
  private async notify(fn: () => Promise<unknown>) {
    await fn().catch(() => undefined);
  }

  // ---------------------------------------------------------------------------
  // Lectura
  // ---------------------------------------------------------------------------

  async list(org: OrgContext, query: ListRafflesQuery) {
    const rows = await this.db.tenantTx(org.id, (tx) =>
      tx.raffle.findMany({
        where: {
          deletedAt: null,
          status: query.status,
          ...(query.q && { title: { contains: query.q, mode: 'insensitive' } }),
        },
        include: { prizes: { orderBy: { position: 'asc' } }, paymentAccounts: true },
        orderBy: [{ drawAt: 'desc' }],
        take: 200,
      }),
    );
    return Promise.all(rows.map((r) => this.present(org, r)));
  }

  async get(org: OrgContext, id: string) {
    return this.present(org, await this.db.tenantTx(org.id, (tx) => this.find(tx, id)));
  }

  private async find(tx: Tx, id: string): Promise<RaffleWithPrizes> {
    const raffle = await tx.raffle.findFirst({
      where: { id, deletedAt: null },
      include: { prizes: { orderBy: { position: 'asc' } }, paymentAccounts: true },
    });
    if (!raffle) throw Errors.notFound('el sorteo');
    return raffle;
  }

  async present(org: Pick<OrgContext, 'slug' | 'timezone' | 'permissions'>, r: RaffleWithPrizes) {
    return {
      id: r.id,
      sequence: r.sequence,
      slug: r.slug,
      publicUrl: `${env().PUBLIC_BASE_URL}/${org.slug}/${r.slug}`,
      title: r.title,
      lottery: r.lottery,
      lotteryDrawCode: r.lotteryDrawCode,
      drawAt: r.drawAt,
      salesCloseAt: r.salesCloseAt,
      pricePerNumber: r.pricePerNumber,
      digits: r.digits,
      totalNumbers: r.totalNumbers,
      minPerOrder: r.minPerOrder,
      numberSelection: r.numberSelection,
      extraDigitsSource: r.extraDigitsSource,
      extraDigitsPosition: r.extraDigitsPosition,
      accentColor: r.accentColor,
      conditionText: r.conditionText,
      authorizationNumber: r.authorizationNumber,
      pageConfig: readPageConfig(r.pageConfig),
      status: r.status,
      coverUrl: r.coverImageKey ? await this.storage.signedGetUrl(r.coverImageKey, 3600) : null,
      gallery: await Promise.all(r.galleryKeys.map(async (key) => ({ key, url: await this.storage.signedGetUrl(key, 3600) }))),
      progress: { paid: r.paidCount, held: r.heldCount, available: r.totalNumbers - r.paidCount - r.heldCount },
      ...(org.permissions.has('payments.view') && { collectedCop: r.paidCount * r.pricePerNumber }),
      publishedAt: r.publishedAt,
      closedAt: r.closedAt,
      drawnAt: r.drawnAt,
      cancelledAt: r.cancelledAt,
      cancelReason: r.cancelReason,
      createdAt: r.createdAt,
      prizes: await Promise.all(
        r.prizes.map(async (p) => ({
          id: p.id,
          position: p.position,
          amountCop: p.amountCop,
          description: p.description,
          rule: p.rule,
          ruleLabel: prizeRuleLabel(p, org.timezone),
          customRuleText: p.customRuleText,
          anticipatedLottery: p.anticipatedLottery,
          anticipatedDrawCode: p.anticipatedDrawCode,
          anticipatedDrawAt: p.anticipatedDrawAt,
          imageKey: p.imageKey,
          imageUrl: p.imageKey ? await this.storage.signedGetUrl(p.imageKey, 3600) : null,
        })),
      ),
      paymentAccountIds: r.paymentAccounts.map((a) => a.paymentAccountId),
    };
  }

  // ---------------------------------------------------------------------------
  // Escritura
  // ---------------------------------------------------------------------------

  async create(org: OrgContext, dto: CreateRaffleDto) {
    this.validatePrizes(dto.digits, dto.prizes);
    this.validateDates(dto.drawAt, dto.salesCloseAt ?? null);
    const raffle = await this.db.tenantTx(org.id, async (tx) => {
      const slug = await this.resolveSlug(tx, dto.slug, dto.title);
      const [{ raffle_sequence: sequence }] = await tx.$queryRaw<{ raffle_sequence: number }[]>`
        UPDATE organizations SET raffle_sequence = raffle_sequence + 1 WHERE id = ${org.id}::uuid RETURNING raffle_sequence`;
      const created = await tx.raffle.create({
        data: {
          organizationId: org.id,
          sequence,
          slug,
          title: dto.title,
          lottery: dto.lottery,
          lotteryDrawCode: dto.lotteryDrawCode ?? null,
          drawAt: dto.drawAt,
          salesCloseAt: dto.salesCloseAt ?? null,
          pricePerNumber: dto.pricePerNumber,
          digits: dto.digits,
          totalNumbers: 10 ** dto.digits,
          minPerOrder: dto.minPerOrder,
          numberSelection: dto.numberSelection,
          extraDigitsSource: dto.digits >= 5 ? (dto.extraDigitsSource ?? null) : null,
          extraDigitsPosition: dto.extraDigitsPosition,
          accentColor: dto.accentColor ?? null,
          conditionText: dto.conditionText ?? null,
          authorizationNumber: dto.authorizationNumber ?? null,
          pageConfig: (dto.pageConfig ?? PageConfig.parse({})) as Prisma.InputJsonValue,
          createdById: org.memberId,
        },
      });
      await this.writePrizes(tx, org.id, created.id, dto.prizes);
      if (dto.paymentAccountIds) await this.linkPaymentAccounts(tx, org.id, created.id, dto.paymentAccountIds);
      await this.audit.record(tx, { action: 'raffle.create', entityType: 'raffle', entityId: created.id, after: { title: created.title, slug } });
      return this.find(tx, created.id);
    });
    return this.present(org, raffle);
  }

  async update(org: OrgContext, id: string, dto: UpdateRaffleDto) {
    const raffle = await this.db.tenantTx(org.id, async (tx) => {
      const current = await this.find(tx, id);
      if (current.status === 'drawn' || current.status === 'cancelled') throw notEditable();
      if (current.status !== 'draft') {
        // Cambiar cómo se arma o se reparte el número después de vender afectaría a quien ya compró.
        const locked = (
          ['digits', 'pricePerNumber', 'slug', 'numberSelection', 'extraDigitsSource', 'extraDigitsPosition', 'minPerOrder'] as const
        ).filter((f) => dto[f] !== undefined && dto[f] !== current[f]);
        if (locked.length > 0) {
          throw Errors.conflict(
            'RAFFLE_LOCKED_FIELD',
            'Después de publicar no se pueden cambiar las cifras, el precio, la dirección, cómo se eligen los números ni la compra mínima.',
            { fields: locked },
          );
        }
      }
      const digits = dto.digits ?? current.digits;
      if (dto.digits && dto.digits !== current.digits) this.validatePrizes(digits, current.prizes);
      // Si cambian las cifras, la fuente de las cifras extra tiene que seguir siendo válida.
      const extraDigitsSource = digits >= 5 ? (dto.extraDigitsSource === undefined ? current.extraDigitsSource : dto.extraDigitsSource) : null;
      const issue = extraDigitsIssue(digits, extraDigitsSource);
      if (issue) throw Errors.validation([{ path: ['extraDigitsSource'], message: issue }], issue);
      this.validateDates(dto.drawAt ?? current.drawAt, dto.salesCloseAt === undefined ? current.salesCloseAt : dto.salesCloseAt);
      const slug = dto.slug && dto.slug !== current.slug ? await this.resolveSlug(tx, dto.slug, current.title) : undefined;

      if (dto.galleryKeys) await this.assertMedia(org.id, id, 'gallery', dto.galleryKeys, current.galleryKeys);
      const { paymentAccountIds, pageConfig, ...fields } = dto;
      const updated = await tx.raffle.update({
        where: { id },
        data: {
          ...fields,
          slug,
          extraDigitsSource,
          ...(pageConfig && { pageConfig: pageConfig as Prisma.InputJsonValue }),
          ...(dto.digits && { totalNumbers: 10 ** dto.digits }),
        },
      });
      if (paymentAccountIds) await this.linkPaymentAccounts(tx, org.id, id, paymentAccountIds);
      await this.audit.record(tx, {
        action: 'raffle.update',
        entityType: 'raffle',
        entityId: id,
        before: pick(current, Object.keys(dto)),
        after: pick(updated, Object.keys(dto)),
      });
      return this.find(tx, id);
    });
    if (SELLING.includes(raffle.status)) await this.scheduler.scheduleRaffle(raffle);
    return this.present(org, raffle);
  }

  async replacePrizes(org: OrgContext, id: string, prizes: PrizeInput[]) {
    const raffle = await this.db.tenantTx(org.id, async (tx) => {
      const current = await this.find(tx, id);
      if (current.status === 'drawn' || current.status === 'cancelled') throw notEditable();
      const hasResult = await tx.drawResult.count({ where: { raffleId: id } });
      if (hasResult) throw Errors.conflict('RESULT_ALREADY_ENTERED', 'El resultado ya se registró: los premios no se pueden cambiar.');
      this.validatePrizes(current.digits, prizes);
      if (current.status !== 'draft' && prizes.length === 0) {
        throw Errors.validation({ field: 'prizes' }, 'Un sorteo publicado necesita al menos un premio.');
      }
      await this.assertMedia(org.id, id, 'prize', prizes.map((p) => p.imageKey), current.prizes.map((p) => p.imageKey).filter((k): k is string => Boolean(k)));
      await tx.prize.deleteMany({ where: { raffleId: id } });
      await this.writePrizes(tx, org.id, id, prizes);
      await this.audit.record(tx, {
        action: 'raffle.prizes_replace',
        entityType: 'raffle',
        entityId: id,
        before: current.prizes.map((p) => ({ rule: p.rule, amountCop: p.amountCop, description: p.description })),
        after: prizes,
      });
      return this.find(tx, id);
    });
    return this.present(org, raffle);
  }

  /**
   * Publica: crea las filas de números (100, 1.000 o 10.000) y programa el
   * cierre de ventas.
   */
  async publish(org: OrgContext, id: string, assertCanActivate?: (tx: Tx) => Promise<void>) {
    const raffle = await this.db.tenantTx(
      org.id,
      async (tx) => {
        const current = await this.find(tx, id);
        if (current.status !== 'draft') throw Errors.conflict('RAFFLE_ALREADY_PUBLISHED', 'Este sorteo ya fue publicado.');
        const now = Date.now();
        const problems: string[] = [];
        if (current.prizes.length === 0) problems.push('Agrega al menos un premio.');
        if (current.drawAt.getTime() <= now) problems.push('La fecha del sorteo ya pasó.');
        if (current.salesCloseAt && current.salesCloseAt.getTime() <= now) problems.push('La hora de cierre de ventas ya pasó.');
        let accountIds = current.paymentAccounts.map((a) => a.paymentAccountId);
        if (accountIds.length === 0) {
          const active = await tx.paymentAccount.findMany({ where: { isActive: true }, select: { id: true } });
          accountIds = active.map((a) => a.id);
          if (accountIds.length === 0) problems.push('Agrega al menos una cuenta para recibir pagos.');
        }
        if (problems.length > 0) {
          throw new AppError('RAFFLE_NOT_READY', 422, `Antes de publicar: ${problems.join(' ')}`, { problems });
        }
        await assertCanActivate?.(tx);
        if (current.paymentAccounts.length === 0) await this.linkPaymentAccounts(tx, org.id, id, accountIds);

        // No se crean filas de números: raffle_numbers guarda solo los tomados.
        await tx.raffle.update({ where: { id }, data: { status: 'active', publishedAt: new Date() } });
        await this.audit.record(tx, { action: 'raffle.publish', entityType: 'raffle', entityId: id, after: { status: 'active' } });
        return this.find(tx, id);
      },
      { timeoutMs: 30_000 },
    );
    await this.scheduler.scheduleRaffle(raffle);
    await this.notify(() => this.notifications.raffleAnnounced(org.id, id));
    return this.present(org, raffle);
  }

  /**
   * Cierra la venta (manual o por el job a la hora límite). Las órdenes
   * apartadas sin comprobante vencen de inmediato (P4). Idempotente.
   */
  async closeSales(organizationId: string, id: string, opts: { manual: boolean }): Promise<boolean> {
    return this.db.tenantTx(organizationId, async (tx) => {
      const res = await tx.raffle.updateMany({
        where: { id, status: { in: SELLING }, deletedAt: null, ...(!opts.manual && { salesCloseAt: { lte: new Date() } }) },
        data: { status: 'closed', closedAt: new Date() },
      });
      if (res.count === 0) {
        if (opts.manual) throw Errors.conflict('RAFFLE_NOT_ON_SALE', 'La venta de este sorteo no está abierta.');
        return false;
      }
      const { orderIds } = await expireReservedOrders(tx, { raffleId: id, onlyDue: false, batchSize: 100_000 });
      await this.audit.record(tx, {
        action: opts.manual ? 'raffle.close_sales' : 'raffle.close_sales_auto',
        entityType: 'raffle',
        entityId: id,
        organizationId,
        after: { status: 'closed', expiredOrders: orderIds.length },
      });
      return true;
    });
  }

  async duplicate(org: OrgContext, id: string, dto: DuplicateRaffleDto) {
    const source = await this.db.tenantTx(org.id, (tx) => this.find(tx, id));
    const title = dto.title ?? `${source.title} (copia)`;
    return this.create(org, {
      title,
      lottery: source.lottery,
      lotteryDrawCode: source.lotteryDrawCode,
      drawAt: dto.drawAt ?? source.drawAt,
      salesCloseAt: source.salesCloseAt,
      pricePerNumber: source.pricePerNumber,
      digits: source.digits as 2 | 3 | 4 | 5 | 6,
      minPerOrder: source.minPerOrder,
      numberSelection: source.numberSelection,
      extraDigitsSource: source.extraDigitsSource,
      extraDigitsPosition: source.extraDigitsPosition,
      accentColor: source.accentColor,
      conditionText: source.conditionText,
      authorizationNumber: source.authorizationNumber,
      pageConfig: readPageConfig(source.pageConfig),
      paymentAccountIds: source.paymentAccounts.map((a) => a.paymentAccountId),
      prizes: source.prizes.map((p) => ({
        amountCop: p.amountCop ?? undefined,
        description: p.description ?? undefined,
        rule: p.rule,
        customRuleText: p.customRuleText ?? undefined,
        anticipatedLottery: p.anticipatedLottery ?? undefined,
        anticipatedDrawCode: p.anticipatedDrawCode,
        anticipatedDrawAt: p.anticipatedDrawAt ?? undefined,
      })),
    }).then(async (created) => {
      await this.db.tenantTx(org.id, (tx) => tx.raffle.update({ where: { id: created.id }, data: { duplicatedFromId: id } }));
      return created;
    });
  }

  /** Cancela (P11): vencen los apartados; lo pagado se conserva (el reembolso es externo). */
  async cancel(org: OrgContext, id: string, reason: string) {
    const raffle = await this.db.tenantTx(org.id, async (tx) => {
      const current = await this.find(tx, id);
      if (!LIVE_STATUSES.includes(current.status)) {
        throw Errors.conflict(
          'RAFFLE_NOT_CANCELLABLE',
          current.status === 'draft' ? 'Un borrador no se cancela: elimínalo.' : 'Este sorteo ya terminó o fue cancelado.',
        );
      }
      await tx.raffle.update({ where: { id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason } });
      const { orderIds } = await expireReservedOrders(tx, { raffleId: id, onlyDue: false, batchSize: 100_000 });
      await this.audit.record(tx, {
        action: 'raffle.cancel',
        entityType: 'raffle',
        entityId: id,
        before: { status: current.status },
        after: { status: 'cancelled', reason, expiredOrders: orderIds.length },
      });
      return this.find(tx, id);
    });
    await this.notify(() => this.notifications.raffleCancelled(org.id, id, reason));
    return this.present(org, raffle);
  }

  /** Solo borradores (borrado lógico; libera la dirección). */
  async remove(org: OrgContext, id: string) {
    await this.db.tenantTx(org.id, async (tx) => {
      const current = await this.find(tx, id);
      if (current.status !== 'draft') {
        throw Errors.conflict('RAFFLE_NOT_DELETABLE', 'Solo se pueden eliminar borradores. Un sorteo publicado se cancela.');
      }
      await tx.raffle.update({ where: { id }, data: { deletedAt: new Date(), slug: `${current.slug}~${Date.now()}` } });
      await this.audit.record(tx, { action: 'raffle.delete', entityType: 'raffle', entityId: id, before: { title: current.title } });
    });
  }

  // ---------------------------------------------------------------------------
  // Portada
  // ---------------------------------------------------------------------------

  private coverPolicy(orgId: string, raffleId: string): UploadPolicy {
    return { prefix: `covers/${orgId}/${raffleId}/`, allowed: IMAGE_TYPES, maxBytes: 5 * MB, label: 'la foto de portada' };
  }

  // ---------------------------------------------------------------------------
  // Galería y fotos de premios (personalización de la página pública)
  // ---------------------------------------------------------------------------

  private mediaPolicy(orgId: string, raffleId: string, kind: MediaKind): UploadPolicy {
    return kind === 'gallery'
      ? { prefix: `gallery/${orgId}/${raffleId}/`, allowed: IMAGE_TYPES, maxBytes: 5 * MB, label: 'la foto' }
      : { prefix: `prizes/${orgId}/${raffleId}/`, allowed: IMAGE_TYPES, maxBytes: 5 * MB, label: 'la foto del premio' };
  }

  async mediaUpload(org: OrgContext, id: string, kind: MediaKind, dto: UploadRequestDto) {
    await this.db.tenantTx(org.id, (tx) => this.find(tx, id));
    return this.uploads.presign(this.mediaPolicy(org.id, id, kind), dto.contentType, dto.size);
  }

  /** Verifica el archivo (tamaño y tipo real) y devuelve su key para guardarla en el sorteo o el premio. */
  async mediaConfirm(org: OrgContext, id: string, kind: MediaKind, key: string) {
    await this.db.tenantTx(org.id, (tx) => this.find(tx, id));
    const file = await this.uploads.verify(this.mediaPolicy(org.id, id, kind), key);
    return { key: file.key, url: await this.storage.signedGetUrl(file.key, 3600) };
  }

  /** Las keys nuevas tienen que ser archivos de este sorteo ya verificados. */
  private async assertMedia(orgId: string, raffleId: string, kind: MediaKind, keys: (string | null | undefined)[], known: string[]) {
    for (const key of keys) {
      if (!key || known.includes(key)) continue;
      await this.uploads.verify(this.mediaPolicy(orgId, raffleId, kind), key);
    }
  }

  async coverUpload(org: OrgContext, id: string, dto: UploadRequestDto) {
    await this.db.tenantTx(org.id, (tx) => this.find(tx, id));
    return this.uploads.presign(this.coverPolicy(org.id, id), dto.contentType, dto.size);
  }

  async coverConfirm(org: OrgContext, id: string, key: string) {
    const file = await this.uploads.verify(this.coverPolicy(org.id, id), key);
    const previous = await this.db.tenantTx(org.id, async (tx) => {
      const current = await this.find(tx, id);
      if (current.status === 'drawn' || current.status === 'cancelled') throw notEditable();
      await tx.raffle.update({ where: { id }, data: { coverImageKey: file.key } });
      await this.audit.record(tx, { action: 'raffle.cover_update', entityType: 'raffle', entityId: id });
      return current.coverImageKey;
    });
    if (previous && previous !== file.key) await this.storage.remove(previous).catch(() => undefined);
    return this.get(org, id);
  }

  // ---------------------------------------------------------------------------
  // Grilla del panel
  // ---------------------------------------------------------------------------

  async numbers(org: OrgContext, id: string) {
    const showContact = can(org, 'participants.view_contact');
    return this.db.tenantTx(org.id, async (tx) => {
      const raffle = await this.find(tx, id);
      const taken = await tx.raffleNumber.findMany({
        where: { raffleId: id, status: { not: 'available' } },
        orderBy: { number: 'asc' },
        include: { order: { include: { participant: true } } },
      });
      return {
        totalNumbers: raffle.totalNumbers,
        digits: raffle.digits,
        taken: taken.map((n) => ({
          number: n.number,
          status: n.status,
          orderId: n.orderId,
          reservedUntil: n.reservedUntil,
          participant: n.order
            ? {
                id: n.order.participant.id,
                name: n.order.participant.name,
                phone: showContact ? n.order.participant.phone : maskPhone(n.order.participant.phone),
              }
            : null,
        })),
      };
    });
  }

  // ---------------------------------------------------------------------------
  // Validaciones y utilidades
  // ---------------------------------------------------------------------------

  private validatePrizes(digits: number, prizes: { rule: Prize['rule'] }[]) {
    const allowed = RULES_BY_DIGITS[digits as 2 | 3 | 4 | 5 | 6];
    const issues = prizes
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => !allowed.includes(p.rule))
      .map(({ p, i }) => ({ path: ['prizes', i, 'rule'], message: `La regla «${p.rule}» no aplica a sorteos de ${digits} cifras.` }));
    if (issues.length > 0) throw Errors.validation(issues, issues[0].message);
  }

  private validateDates(drawAt: Date, salesCloseAt: Date | null) {
    if (salesCloseAt && salesCloseAt.getTime() > drawAt.getTime()) {
      throw Errors.validation(
        [{ path: ['salesCloseAt'], message: 'El cierre de ventas debe ser antes del sorteo.' }],
        'El cierre de ventas debe ser antes del sorteo.',
      );
    }
  }

  private async resolveSlug(tx: Tx, requested: string | undefined, title: string): Promise<string> {
    if (requested) {
      const clash = await tx.raffle.findFirst({ where: { slug: requested } });
      if (clash) throw Errors.slugTaken();
      return requested;
    }
    const base = slugify(title, 50) || 'sorteo';
    for (let i = 1; i < 100; i++) {
      const candidate = i === 1 ? base : `${base}-${i}`;
      if (!(await tx.raffle.findFirst({ where: { slug: candidate } }))) return candidate;
    }
    throw Errors.slugTaken();
  }

  private async writePrizes(tx: Tx, organizationId: string, raffleId: string, prizes: PrizeInput[]) {
    if (prizes.length === 0) return;
    await tx.prize.createMany({
      data: prizes.map((p, i) => ({
        organizationId,
        raffleId,
        position: i + 1,
        amountCop: p.amountCop ?? null,
        description: p.description ?? null,
        rule: p.rule,
        customRuleText: p.customRuleText ?? null,
        anticipatedLottery: p.anticipatedLottery ?? null,
        anticipatedDrawCode: p.anticipatedDrawCode ?? null,
        anticipatedDrawAt: p.anticipatedDrawAt ?? null,
        // Solo keys de este sorteo (las nuevas ya pasaron por assertMedia).
        imageKey: p.imageKey?.startsWith(`prizes/${organizationId}/${raffleId}/`) ? p.imageKey : null,
      })),
    });
  }

  private async linkPaymentAccounts(tx: Tx, organizationId: string, raffleId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    const found = await tx.paymentAccount.count({ where: { id: { in: unique }, isActive: true } });
    if (found !== unique.length) throw Errors.validation({ field: 'paymentAccountIds' }, 'Alguna cuenta de pago no existe.');
    await tx.rafflePaymentAccount.deleteMany({ where: { raffleId } });
    await tx.rafflePaymentAccount.createMany({
      data: unique.map((paymentAccountId) => ({ raffleId, paymentAccountId, organizationId })),
    });
  }
}

function pick<T extends object>(obj: T, keys: string[]): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(Object.fromEntries(Object.entries(obj).filter(([k]) => keys.includes(k)))));
}
