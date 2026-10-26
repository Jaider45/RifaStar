import { Injectable } from '@nestjs/common';
import type { DrawResult, Prize, Raffle, Winner } from '@prisma/client';
import { AppError, Errors } from '../common/errors';
import { formatNumber } from '../common/format';
import { displayName, type NameFormat } from '../common/privacy';
import { maskPhone } from '../common/phone';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import { expireReservedOrders } from '../orders/order-ops';
import { ParticipantsService } from '../participants/participants.service';
import { prizeRuleLabel } from '../raffles/prize-rules';
import { SettingsService } from '../settings/settings.service';
import { EVIDENCE_TYPES, MB } from '../storage/file-type';
import { StorageProvider } from '../storage/storage.provider';
import { type UploadPolicy, UploadsService } from '../storage/uploads.service';
import type { OrgContext } from '../tenancy/org-context';
import { StepUpService } from '../auth/step-up.service';
import { localDateKey } from '../common/time';
import { ManagerAlertsService } from '../messaging/manager-alerts.service';
import { composeFullNumber, type Digits, extraResultField, needsAnticipated, winningNumber } from './winner-rules';
import type { EnterResultDto } from './results.dto';

const ENTERABLE = ['active', 'sold_out', 'closed'] as const;

interface ComputedWinner {
  prizeId: string;
  number: number;
}

@Injectable()
export class ResultsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly storage: StorageProvider,
    private readonly settings: SettingsService,
    private readonly stepUp: StepUpService,
    private readonly managerAlerts: ManagerAlertsService,
  ) {}

  private async raffleFor(tx: Tx, id: string) {
    const raffle = await tx.raffle.findFirst({
      where: { id, deletedAt: null },
      include: { prizes: { orderBy: { position: 'asc' } }, drawResult: true },
    });
    if (!raffle) throw Errors.notFound('el sorteo');
    return raffle;
  }

  /**
   * Registra (o corrige, antes de publicar) el resultado y calcula los
   * ganadores. Si la venta seguía abierta, se cierra.
   */
  async enter(org: OrgContext, raffleId: string, dto: EnterResultDto) {
    // El resultado define quién gana: se confirma con el código de 2FA en el momento.
    await this.stepUp.verify(org, dto.totpCode);
    await this.db.tenantTx(org.id, async (tx) => {
      const raffle = await this.raffleFor(tx, raffleId);
      if (raffle.resultsPublishedAt) {
        throw Errors.conflict('RESULTS_PUBLISHED', 'Los resultados ya se publicaron y no se pueden cambiar.');
      }
      if (!(ENTERABLE as readonly string[]).includes(raffle.status)) {
        throw Errors.conflict('RAFFLE_NOT_DRAWABLE', 'Este sorteo no admite resultados (borrador o cancelado).');
      }
      this.validateCustom(raffle, dto.customWinners ?? []);
      const needed = extraResultField(raffle.digits as Digits, { source: raffle.extraDigitsSource, position: raffle.extraDigitsPosition });
      if (needed === 'series' && !dto.seriesResult) {
        throw Errors.validation({ field: 'seriesResult' }, `Este sorteo de ${raffle.digits} cifras juega con la serie: escribe la serie de la lotería (3 dígitos).`);
      }
      if (needed === 'fifthDigit' && !dto.fifthDigit) {
        throw Errors.validation({ field: 'fifthDigit' }, 'Este sorteo de 5 cifras juega con la quinta cifra del chance: escríbela.');
      }

      if (raffle.status !== 'closed') {
        await tx.raffle.update({ where: { id: raffleId }, data: { status: 'closed', closedAt: new Date() } });
        await expireReservedOrders(tx, { raffleId, onlyDue: false, batchSize: 100_000 });
      }
      const before = raffle.drawResult;
      const data = {
        mainResult: dto.mainResult,
        anticipatedResult: dto.anticipatedResult ?? null,
        seriesResult: needed === 'series' ? dto.seriesResult! : (dto.seriesResult ?? null),
        fifthDigit: needed === 'fifthDigit' ? dto.fifthDigit! : (dto.fifthDigit ?? null),
        customWinners: dto.customWinners ?? [],
        enteredById: org.memberId!,
        enteredAt: new Date(),
      };
      const result = before
        ? await tx.drawResult.update({ where: { raffleId }, data: { ...data, revision: { increment: 1 } } })
        : await tx.drawResult.create({ data: { ...data, organizationId: org.id, raffleId } });
      await this.recompute(tx, raffle, result);
      const snapshot = (r: DrawResult) => ({
        mainResult: r.mainResult,
        anticipatedResult: r.anticipatedResult,
        seriesResult: r.seriesResult,
        fifthDigit: r.fifthDigit,
        customWinners: r.customWinners,
      });
      await this.audit.record(tx, {
        action: before ? 'result.correct' : 'result.enter',
        entityType: 'draw_result',
        entityId: result.id,
        before: before && snapshot(before),
        after: { ...snapshot(result), confirmedWith2fa: true },
      });
    });
    // Aviso a los gestores con los ganadores (no hace fallar el ingreso).
    await this.managerAlerts.winnersComputed(org.id, raffleId).catch(() => undefined);
    return this.winners(org, raffleId);
  }


  async recalculate(org: OrgContext, raffleId: string) {
    await this.db.tenantTx(org.id, async (tx) => {
      const raffle = await this.raffleFor(tx, raffleId);
      if (!raffle.drawResult) throw Errors.conflict('RESULT_MISSING', 'Primero registra el resultado de la lotería.');
      await this.recompute(tx, raffle, raffle.drawResult);
      await this.audit.record(tx, { action: 'winners.recalculate', entityType: 'raffle', entityId: raffleId });
    });
    return this.winners(org, raffleId);
  }

  private validateCustom(raffle: Raffle & { prizes: Prize[] }, custom: ComputedWinner[]) {
    for (const c of custom) {
      const prize = raffle.prizes.find((p) => p.id === c.prizeId);
      if (!prize || prize.rule !== 'custom') {
        throw Errors.validation({ field: 'customWinners' }, 'Solo los premios con regla especial llevan número manual.');
      }
      if (c.number >= raffle.totalNumbers) {
        throw Errors.validation({ field: 'customWinners' }, `El número debe estar entre ${formatNumber(0, raffle.digits)} y ${formatNumber(raffle.totalNumbers - 1, raffle.digits)}.`);
      }
    }
  }

  /**
   * Calcula los ganadores. Solo ganan números `paid`; si el número no se
   * vendió, el premio queda «No vendido». Conserva las filas que no cambian
   * (y su estado de entrega) y no permite cambiar un premio ya entregado.
   */
  private async recompute(tx: Tx, raffle: Raffle & { prizes: Prize[] }, result: DrawResult) {
    const custom = (result.customWinners as unknown as ComputedWinner[] | null) ?? [];
    const desired: ComputedWinner[] = [];
    for (const prize of raffle.prizes) {
      if (prize.rule === 'custom') {
        desired.push(...custom.filter((c) => c.prizeId === prize.id));
        continue;
      }
      const n = winningNumber(prize.rule, raffle.digits as Digits, result.mainResult, result.anticipatedResult, {
        config: { source: raffle.extraDigitsSource, position: raffle.extraDigitsPosition },
        result: { series: result.seriesResult, fifthDigit: result.fifthDigit },
      });
      if (n !== null) desired.push({ prizeId: prize.id, number: n });
    }

    const numbers = [...new Set(desired.map((d) => d.number))];
    const owners = await tx.raffleNumber.findMany({
      where: { raffleId: raffle.id, number: { in: numbers }, status: 'paid' },
      include: { order: { include: { tickets: { where: { status: 'valid' } } } } },
    });
    const ownerOf = new Map(owners.map((o) => [o.number, o]));

    const existing = await tx.winner.findMany({ where: { raffleId: raffle.id } });
    const key = (w: { prizeId: string; number: number }) => `${w.prizeId}:${w.number}`;
    const desiredRows = desired.map((d) => {
      const owner = ownerOf.get(d.number);
      return {
        ...d,
        participantId: owner?.order?.participantId ?? null,
        ticketId: owner?.order?.tickets.find((t) => t.number === d.number)?.id ?? null,
      };
    });
    const desiredKeys = new Set(desiredRows.map(key));

    const stale = existing.filter((w) => {
      const match = desiredRows.find((d) => key(d) === key(w));
      return !match || match.participantId !== w.participantId;
    });
    if (stale.some((w) => w.deliveryStatus === 'delivered')) {
      throw Errors.conflict('WINNER_ALREADY_DELIVERED', 'Hay un premio ya entregado que cambiaría con este resultado. Revisa antes de corregir.');
    }
    if (stale.length > 0) await tx.winner.deleteMany({ where: { id: { in: stale.map((w) => w.id) } } });

    const kept = new Set(existing.filter((w) => !stale.includes(w)).map(key));
    const toCreate = desiredRows.filter((d) => !kept.has(key(d)) && desiredKeys.has(key(d)));
    if (toCreate.length > 0) {
      await tx.winner.createMany({
        data: toCreate.map((d) => ({
          organizationId: raffle.organizationId,
          raffleId: raffle.id,
          prizeId: d.prizeId,
          drawResultId: result.id,
          number: d.number,
          unsold: d.participantId === null,
          participantId: d.participantId,
          ticketId: d.ticketId,
        })),
      });
    }
  }

  /** Vista del panel: resultado, premios y ganador de cada uno. */
  async winners(org: OrgContext, raffleId: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const raffle = await this.raffleFor(tx, raffleId);
      const winners = await tx.winner.findMany({ where: { raffleId }, include: { participant: true, ticket: true } });
      const result = raffle.drawResult;
      return {
        raffle: {
          id: raffle.id,
          title: raffle.title,
          status: raffle.status,
          digits: raffle.digits,
          lottery: raffle.lottery,
          drawAt: raffle.drawAt,
          extraDigitsSource: raffle.extraDigitsSource,
          extraDigitsPosition: raffle.extraDigitsPosition,
          resultsPublishedAt: raffle.resultsPublishedAt,
        },
        result: result && {
          mainResult: result.mainResult,
          anticipatedResult: result.anticipatedResult,
          seriesResult: result.seriesResult,
          fifthDigit: result.fifthDigit,
          label: ManagerAlertsService.resultLabel(raffle, result),
          revision: result.revision,
          enteredAt: result.enteredAt,
          managersNotified: (result.managersNotifiedRevision ?? 0) >= result.revision,
          evidenceUrls: await Promise.all(result.evidenceKeys.map((k) => this.storage.signedGetUrl(k, 600))),
        },
        /** Lo que reportó LoteríaYa (informativo: el equipo ingresa y confirma el resultado). */
        lotteryReport: await this.lotteryReport(tx, raffle, org.timezone),
        prizes: raffle.prizes.map((p) => {
          const rows = winners.filter((w) => w.prizeId === p.id);
          return {
            prizeId: p.id,
            position: p.position,
            amountCop: p.amountCop,
            description: p.description,
            ruleLabel: prizeRuleLabel(p, org.timezone),
            pending: rows.length === 0,
            pendingReason: rows.length > 0 ? null : this.pendingReason(p, result),
            winners: rows.map((w) => this.presentWinner(org, raffle.digits, w)),
          };
        }),
      };
    });
  }

  /** Resultado de LoteríaYa para la lotería y el anticipado del sorteo, en la fecha local del sorteo. */
  private async lotteryReport(tx: Tx, raffle: Raffle & { prizes: Prize[] }, timezone: string) {
    if (!raffle.lotteryDrawCode) return null;
    const drawDate = new Date(`${localDateKey(raffle.drawAt, timezone)}T00:00:00Z`);
    const main = await tx.lotteryResult.findUnique({ where: { drawCode_drawDate: { drawCode: raffle.lotteryDrawCode, drawDate } } });
    const anticipatedPrize = raffle.prizes.find((p) => p.anticipatedDrawCode);
    const anticipated = anticipatedPrize?.anticipatedDrawCode
      ? await tx.lotteryResult.findUnique({
          where: {
            drawCode_drawDate: {
              drawCode: anticipatedPrize.anticipatedDrawCode,
              drawDate: new Date(`${localDateKey(anticipatedPrize.anticipatedDrawAt ?? raffle.drawAt, timezone)}T00:00:00Z`),
            },
          },
        })
      : null;
    if (!main && !anticipated) return { source: 'LoteríaYa', main: null, anticipated: null };
    const present = (r: typeof main) =>
      r && { drawName: r.drawName, winningNumber: r.winningNumber, winningSeries: r.winningSeries, fifthDigit: r.fifthDigit, status: r.status, receivedAt: r.receivedAt };
    return { source: 'LoteríaYa', main: present(main), anticipated: present(anticipated) };
  }

  private fullNumber(raffle: Raffle, r: DrawResult): string | null {
    if (raffle.digits < 5) return null;
    try {
      return composeFullNumber(
        raffle.digits as Digits,
        r.mainResult,
        { source: raffle.extraDigitsSource, position: raffle.extraDigitsPosition },
        { series: r.seriesResult, fifthDigit: r.fifthDigit },
      );
    } catch {
      return null;
    }
  }

  private pendingReason(p: Prize, result: DrawResult | null): string {
    if (!result) return 'Falta el resultado de la lotería.';
    if (needsAnticipated(p.rule)) return 'Falta el resultado del anticipado.';
    if (p.rule === 'custom') return 'Falta indicar el número ganador.';
    return 'Sin calcular.';
  }

  private presentWinner(
    org: OrgContext,
    digits: number,
    w: Winner & { participant: { name: string; phone: string } | null; ticket: { code: string } | null },
  ) {
    return {
      id: w.id,
      number: formatNumber(w.number, digits),
      unsold: w.unsold,
      label: w.unsold ? 'No vendido' : w.participant!.name,
      participant: w.participant && { name: w.participant.name, phone: ParticipantsService.phoneFor(org, w.participant.phone) },
      ticketCode: w.ticket?.code ?? null,
      deliveryStatus: w.deliveryStatus,
      deliveredAt: w.deliveredAt,
      deliveryNote: w.deliveryNote,
    };
  }

  async deliver(org: OrgContext, winnerId: string, note?: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const w = await tx.winner.findFirst({ where: { id: winnerId } });
      if (!w) throw Errors.notFound('el ganador');
      if (w.unsold) throw Errors.conflict('WINNER_UNSOLD', 'Este premio quedó «No vendido»: no hay a quién entregarlo.');
      if (w.deliveryStatus === 'delivered') return { id: w.id, deliveryStatus: w.deliveryStatus, deliveredAt: w.deliveredAt };
      const updated = await tx.winner.update({
        where: { id: winnerId },
        data: { deliveryStatus: 'delivered', deliveredAt: new Date(), deliveredById: org.memberId, deliveryNote: note ?? null },
      });
      await this.audit.record(tx, { action: 'winner.deliver', entityType: 'winner', entityId: winnerId, after: { note: note ?? null } });
      return { id: updated.id, deliveryStatus: updated.deliveryStatus, deliveredAt: updated.deliveredAt };
    });
  }

  /** Publica: el sorteo pasa a `drawn` y los resultados se ven en el enlace público. */
  async publish(org: OrgContext, raffleId: string) {
    await this.db.tenantTx(org.id, async (tx) => {
      const raffle = await this.raffleFor(tx, raffleId);
      if (!raffle.drawResult) throw Errors.conflict('RESULT_MISSING', 'Primero registra el resultado de la lotería.');
      if (raffle.resultsPublishedAt) return;
      const counts = await tx.winner.groupBy({ by: ['prizeId'], where: { raffleId }, _count: true });
      const missing = raffle.prizes.filter((p) => !counts.some((c) => c.prizeId === p.id));
      if (missing.length > 0) {
        throw new AppError(
          'RESULTS_INCOMPLETE',
          422,
          'Faltan ganadores por calcular antes de publicar (revisa el anticipado o los premios especiales).',
          { prizeIds: missing.map((p) => p.id) },
        );
      }
      const now = new Date();
      await tx.raffle.update({ where: { id: raffleId }, data: { status: 'drawn', drawnAt: now, resultsPublishedAt: now } });
      await tx.drawResult.update({ where: { raffleId }, data: { publishedAt: now } });
      await this.audit.record(tx, { action: 'results.publish', entityType: 'raffle', entityId: raffleId, after: { status: 'drawn' } });
    });
    return this.winners(org, raffleId);
  }

  // ---------------------------------------------------------------------------
  // Evidencia (foto o video del resultado)
  // ---------------------------------------------------------------------------

  private evidencePolicy(orgId: string, raffleId: string): UploadPolicy {
    return { prefix: `evidence/${orgId}/${raffleId}/`, allowed: EVIDENCE_TYPES, maxBytes: 50 * MB, label: 'la evidencia' };
  }

  async evidenceUpload(org: OrgContext, raffleId: string, contentType: string, size: number) {
    await this.db.tenantTx(org.id, (tx) => this.raffleFor(tx, raffleId));
    return this.uploads.presign(this.evidencePolicy(org.id, raffleId), contentType, size);
  }

  async evidenceConfirm(org: OrgContext, raffleId: string, key: string) {
    const file = await this.uploads.verify(this.evidencePolicy(org.id, raffleId), key);
    await this.db.tenantTx(org.id, async (tx) => {
      const raffle = await this.raffleFor(tx, raffleId);
      if (!raffle.drawResult) throw Errors.conflict('RESULT_MISSING', 'Primero registra el resultado de la lotería.');
      if (raffle.drawResult.evidenceKeys.length >= 10) {
        throw Errors.conflict('EVIDENCE_LIMIT', 'Puedes adjuntar hasta 10 archivos de evidencia.');
      }
      await tx.drawResult.update({ where: { raffleId }, data: { evidenceKeys: { push: file.key } } });
      await this.audit.record(tx, { action: 'result.evidence_add', entityType: 'draw_result', entityId: raffle.drawResult.id });
    });
    return this.winners(org, raffleId);
  }

  // ---------------------------------------------------------------------------
  // Público
  // ---------------------------------------------------------------------------

  async publicResults(organizationId: string, raffleSlug: string, timezone: string) {
    return this.db.tenantTx(organizationId, async (tx) => {
      const raffle = await tx.raffle.findFirst({
        where: { slug: raffleSlug, deletedAt: null, status: { not: 'draft' } },
        include: { prizes: { orderBy: { position: 'asc' } }, drawResult: true },
      });
      if (!raffle) throw Errors.notFound('el sorteo');
      if (!raffle.resultsPublishedAt || !raffle.drawResult) {
        throw new AppError('RESULTS_NOT_PUBLISHED', 404, 'Los resultados de este sorteo todavía no se han publicado.');
      }
      const nameFormat = (await this.settings.read(tx, 'ranking')).data.nameFormat as NameFormat;
      const winners = await tx.winner.findMany({ where: { raffleId: raffle.id }, include: { participant: true } });
      return {
        raffle: { slug: raffle.slug, title: raffle.title, lottery: raffle.lottery, drawAt: raffle.drawAt, digits: raffle.digits },
        result: {
          mainResult: raffle.drawResult.mainResult,
          anticipatedResult: raffle.drawResult.anticipatedResult,
          seriesResult: raffle.drawResult.seriesResult,
          fifthDigit: raffle.drawResult.fifthDigit,
          label: ManagerAlertsService.resultLabel(raffle, raffle.drawResult),
          /** Número completo en sorteos de 5 y 6 cifras (4 cifras + serie o quinta cifra). */
          fullNumber: this.fullNumber(raffle, raffle.drawResult),
          /** Atribución exigida por los términos de LoteríaYa cuando el sorteo usa su catálogo. */
          attribution: raffle.lotteryDrawCode ? { name: 'LoteríaYa', url: 'https://www.loteriaya.com.co' } : null,
          publishedAt: raffle.resultsPublishedAt,
          evidenceUrls: await Promise.all(raffle.drawResult.evidenceKeys.map((k) => this.storage.signedGetUrl(k, 3600))),
        },
        prizes: raffle.prizes.map((p) => ({
          position: p.position,
          amountCop: p.amountCop,
          description: p.description,
          ruleLabel: prizeRuleLabel(p, timezone),
          winners: winners
            .filter((w) => w.prizeId === p.id)
            .map((w) => ({
              number: formatNumber(w.number, raffle.digits),
              unsold: w.unsold,
              name: w.unsold ? 'No vendido' : displayName(w.participant!, nameFormat),
              phone: w.unsold ? null : maskPhone(w.participant!.phone),
              delivered: w.deliveryStatus === 'delivered',
            })),
        })),
      };
    });
  }
}
