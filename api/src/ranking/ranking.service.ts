import { Injectable, type OnModuleInit } from '@nestjs/common';
import { Prisma, type RankingPeriod } from '@prisma/client';
import { Errors } from '../common/errors';
import { maskPhone } from '../common/phone';
import { displayName, type NameFormat } from '../common/privacy';
import { requestContext } from '../common/request-context';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import { type OrderEvent, OrderHooks } from '../orders/order-hooks';
import { csvCell, ParticipantsService } from '../participants/participants.service';
import type { RankingSettings } from '../settings/schemas';
import { SettingsService } from '../settings/settings.service';
import type { OrgContext } from '../tenancy/org-context';
import { periodFor } from './periods';

export interface Standing {
  rank: number;
  participantId: string;
  name: string;
  nickname: string | null;
  phone: string;
  points: number;
  raffles: number;
  investedCop: number;
  reachedAt: Date;
}

export interface SnapshotRow extends Omit<Standing, 'phone' | 'reachedAt'> {
  maskedPhone: string;
  reachedAt: string;
}

export interface PeriodClosedEvent {
  organizationId: string;
  periodId: string;
}

type ClosedHandler = (e: PeriodClosedEvent) => Promise<void>;

/**
 * Ranking (regla 6). Los puntos viven en el libro inmutable `points_events`;
 * las posiciones siempre se calculan a partir de él.
 */
@Injectable()
export class RankingService implements OnModuleInit {
  private readonly closedHandlers: ClosedHandler[] = [];

  constructor(
    private readonly db: DatabaseService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly hooks: OrderHooks,
  ) {}

  onModuleInit(): void {
    this.hooks.inTransaction((tx, e) => this.onOrderEvent(tx, e));
  }

  /** Para la fase de notificaciones: se llama después de cerrar un periodo. */
  onPeriodClosed(handler: ClosedHandler): void {
    this.closedHandlers.push(handler);
  }

  // ---------------------------------------------------------------------------
  // Periodos
  // ---------------------------------------------------------------------------

  private async config(tx: Tx): Promise<RankingSettings> {
    return (await this.settings.read(tx, 'ranking')).data;
  }

  private async timezone(tx: Tx, organizationId: string): Promise<string> {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    return org.timezone;
  }

  /**
   * Periodo abierto que contiene `at`. Si el abierto ya terminó (el job aún no
   * corrió), lo cierra aquí mismo y abre el que corresponde.
   */
  async periodFor(tx: Tx, organizationId: string, at: Date, cfg?: RankingSettings): Promise<RankingPeriod> {
    const config = cfg ?? (await this.config(tx));
    const tz = await this.timezone(tx, organizationId);
    const [open] = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM ranking_periods WHERE organization_id = ${organizationId}::uuid AND status = 'open' FOR UPDATE`;
    const period = open ? await tx.rankingPeriod.findUniqueOrThrow({ where: { id: open.id } }) : null;
    if (period && at < period.endsAt) return period;
    if (period) await this.close(tx, period, config);

    const bounds = periodFor(at, tz, config.frequency, config.weeklyResetDay);
    const existing = await tx.rankingPeriod.findFirst({ where: { startsAt: { lte: at }, endsAt: { gt: at } } });
    if (existing) return existing;
    // Si cambió la frecuencia, el nuevo periodo empieza donde terminó el anterior (sin solaparse).
    const last = await tx.rankingPeriod.findFirst({ where: { endsAt: { gt: bounds.startsAt } }, orderBy: { endsAt: 'desc' } });
    const startsAt = last && last.endsAt > bounds.startsAt ? last.endsAt : bounds.startsAt;
    return tx.rankingPeriod.create({
      data: { organizationId, frequency: config.frequency, label: bounds.label, startsAt, endsAt: bounds.endsAt },
    });
  }

  private async close(tx: Tx, period: RankingPeriod, config: RankingSettings) {
    const standings = await this.standings(tx, period.id, config.tiebreaker);
    const snapshot: SnapshotRow[] = standings.slice(0, 100).map(({ phone, reachedAt, ...s }) => ({
      ...s,
      maskedPhone: maskPhone(phone),
      reachedAt: reachedAt.toISOString(),
    }));
    await tx.rankingPeriod.update({
      where: { id: period.id },
      data: {
        status: 'closed',
        closedAt: new Date(),
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        configSnapshot: config as unknown as Prisma.InputJsonValue,
      },
    });
    await this.audit.record(tx, {
      action: 'ranking.period_close',
      entityType: 'ranking_period',
      entityId: period.id,
      organizationId: period.organizationId,
      after: { label: period.label, participants: standings.length },
    });
  }

  /**
   * ranking-rollover: cierra el periodo vencido (snapshot) y abre el nuevo.
   * Idempotente: si no hay periodo vencido no hace nada.
   */
  async rollover(organizationId: string, now = new Date()): Promise<string | null> {
    const closedId = await requestContext.run(
      { requestId: `job-rollover-${organizationId}`, actor: { type: 'system', id: null }, organizationId },
      () =>
        this.db.tenantTx(organizationId, async (tx) => {
          const config = await this.config(tx);
          const open = await tx.rankingPeriod.findFirst({ where: { status: 'open' } });
          if (!open || open.endsAt > now) {
            if (!open && config.enabled) await this.periodFor(tx, organizationId, now, config);
            return null;
          }
          await this.periodFor(tx, organizationId, now, config);
          return open.id;
        }),
    );
    if (closedId) for (const h of this.closedHandlers) await h({ organizationId, periodId: closedId });
    return closedId;
  }

  // ---------------------------------------------------------------------------
  // Libro de puntos
  // ---------------------------------------------------------------------------

  private async onOrderEvent(tx: Tx, e: OrderEvent): Promise<void> {
    if (e.type === 'approved') await this.awardForApproval(tx, e);
    if (e.type === 'released' && e.previousStatus === 'approved') await this.reverseOrder(tx, e);
  }

  /** Inserta un evento si su clave de idempotencia no existe. */
  private async insert(tx: Tx, data: Prisma.PointsEventUncheckedCreateInput): Promise<boolean> {
    const rows = await tx.$queryRaw<{ id: bigint }[]>`
      INSERT INTO points_events (organization_id, period_id, participant_id, points, reason, order_id, raffle_id, actor_member_id, note, idempotency_key, created_at)
      VALUES (${data.organizationId}::uuid, ${data.periodId}::uuid, ${data.participantId}::uuid, ${data.points},
              ${data.reason}::"PointsReason", ${data.orderId ?? null}::uuid, ${data.raffleId ?? null}::uuid,
              ${data.actorMemberId ?? null}::uuid, ${data.note ?? null}, ${data.idempotencyKey}, ${data.createdAt ?? new Date()})
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id`;
    return rows.length === 1;
  }

  /** Puntos por número pagado + bonos (constancia y referido) al aprobar. */
  async awardForApproval(tx: Tx, e: OrderEvent): Promise<void> {
    const config = await this.config(tx);
    if (!config.enabled || !(await this.planAllowsRanking(tx, e.organizationId))) return;
    const period = await this.periodFor(tx, e.organizationId, e.at, config);
    await this.insert(tx, {
      organizationId: e.organizationId,
      periodId: period.id,
      participantId: e.participantId,
      points: e.numbers.length * config.pointsPerNumber,
      reason: 'number_paid',
      orderId: e.orderId,
      raffleId: e.raffleId,
      idempotencyKey: `order:${e.orderId}:paid`,
      createdAt: e.at,
    });

    if (config.consistencyBonus.enabled) {
      const [{ raffles }] = await tx.$queryRaw<{ raffles: number }[]>`
        SELECT COUNT(*)::int AS raffles FROM (
          SELECT raffle_id FROM points_events
           WHERE period_id = ${period.id}::uuid AND participant_id = ${e.participantId}::uuid AND reason = 'number_paid'
           GROUP BY raffle_id HAVING SUM(points) > 0) r`;
      if (raffles >= config.consistencyBonus.minRaffles) {
        await this.insert(tx, {
          organizationId: e.organizationId,
          periodId: period.id,
          participantId: e.participantId,
          points: config.consistencyBonus.points,
          reason: 'consistency_bonus',
          raffleId: e.raffleId,
          idempotencyKey: `bonus:consistency:${period.id}:${e.participantId}`,
          createdAt: e.at,
        });
      }
    }

    if (config.referralBonus.enabled) {
      const p = await tx.participant.findUniqueOrThrow({ where: { id: e.participantId }, select: { referredById: true } });
      if (p.referredById) {
        await this.insert(tx, {
          organizationId: e.organizationId,
          periodId: period.id,
          participantId: p.referredById,
          points: config.referralBonus.points,
          reason: 'referral_bonus',
          orderId: e.orderId,
          idempotencyKey: `bonus:referral:${e.participantId}`,
          createdAt: e.at,
        });
      }
    }
  }

  /**
   * Liberar una orden aprobada (P9) revierte sus puntos con un evento negativo
   * en el mismo periodo, si sigue abierto. Un periodo cerrado ya no cambia.
   */
  private async reverseOrder(tx: Tx, e: OrderEvent): Promise<void> {
    const groups = await tx.pointsEvent.groupBy({
      by: ['periodId', 'participantId'],
      where: { orderId: e.orderId, reason: 'number_paid' },
      _sum: { points: true },
    });
    for (const g of groups) {
      const net = g._sum.points ?? 0;
      if (net <= 0) continue;
      const period = await tx.rankingPeriod.findFirst({ where: { id: g.periodId } });
      if (period?.status !== 'open') {
        await this.audit.record(tx, {
          action: 'ranking.reversal_skipped',
          entityType: 'order',
          entityId: e.orderId,
          after: { reason: 'Periodo cerrado', periodId: g.periodId, points: net },
        });
        continue;
      }
      await this.insert(tx, {
        organizationId: e.organizationId,
        periodId: g.periodId,
        participantId: g.participantId,
        points: -net,
        reason: 'number_paid',
        orderId: e.orderId,
        raffleId: e.raffleId,
        note: 'Reversión por liberación de la orden',
        idempotencyKey: `order:${e.orderId}:reversal`,
        createdAt: e.at,
      });
    }
  }

  /** Ajuste manual con motivo: queda en el libro y en la auditoría. */
  async adjust(org: OrgContext, participantId: string, points: number, reason: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const participant = await tx.participant.findFirst({ where: { id: participantId } });
      if (!participant) throw Errors.notFound('el participante');
      const config = await this.config(tx);
      if (!config.enabled) throw Errors.conflict('RANKING_DISABLED', 'Activa el ranking en Ajustes para hacer ajustes.');
      const period = await this.periodFor(tx, org.id, new Date(), config);
      const now = new Date();
      await this.insert(tx, {
        organizationId: org.id,
        periodId: period.id,
        participantId,
        points,
        reason: 'manual_adjustment',
        actorMemberId: org.memberId,
        note: reason,
        idempotencyKey: `manual:${requestContext.get()?.requestId ?? now.getTime()}:${participantId}`,
        createdAt: now,
      });
      await this.audit.record(tx, {
        action: 'ranking.manual_adjustment',
        entityType: 'participant',
        entityId: participantId,
        after: { points, reason, periodId: period.id },
      });
      return { periodId: period.id, participantId, points, reason };
    });
  }

  // ---------------------------------------------------------------------------
  // Posiciones
  // ---------------------------------------------------------------------------

  /**
   * Calcula la tabla del periodo. Desempate: `first_to_reach` = quien llegó
   * primero a su total (y se mantuvo); `most_raffles` = quien jugó más sorteos (y luego quien
   * llegó primero). `asOf` permite calcular la tabla en un momento anterior.
   */
  async standings(tx: Tx, periodId: string, tiebreaker: RankingSettings['tiebreaker'], asOf?: Date): Promise<Standing[]> {
    const cutoff = asOf ? Prisma.sql`AND created_at < ${asOf}` : Prisma.empty;
    const order =
      tiebreaker === 'most_raffles'
        ? Prisma.sql`t.points DESC, COALESCE(r.raffles, 0) DESC, re.reached_at ASC, t.participant_id ASC`
        : Prisma.sql`t.points DESC, re.reached_at ASC, t.participant_id ASC`;
    const rows = await tx.$queryRaw<
      { participant_id: string; name: string; nickname: string | null; phone: string; points: number; raffles: number; invested: number; reached_at: Date }[]
    >`
      WITH ev AS (
        SELECT * FROM points_events WHERE period_id = ${periodId}::uuid ${cutoff}
      ),
      totals AS (
        SELECT participant_id, SUM(points)::int AS points FROM ev GROUP BY participant_id HAVING SUM(points) > 0
      ),
      running AS (
        SELECT participant_id, created_at,
               SUM(points) OVER (PARTITION BY participant_id ORDER BY created_at, id) AS acc,
               ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY created_at, id) AS rn
          FROM ev
      ),
      last_below AS (
        SELECT r.participant_id, MAX(r.rn) AS rn
          FROM running r JOIN totals t USING (participant_id)
         WHERE r.acc < t.points
         GROUP BY r.participant_id
      ),
      -- Momento desde el cual el participante se mantiene en su total actual
      -- (si bajó por un ajuste y volvió a subir, cuenta la última vez).
      re AS (
        SELECT r.participant_id, MIN(r.created_at) AS reached_at
          FROM running r
          JOIN totals t USING (participant_id)
          LEFT JOIN last_below lb USING (participant_id)
         WHERE r.acc >= t.points AND r.rn > COALESCE(lb.rn, 0)
         GROUP BY r.participant_id
      ),
      per_raffle AS (
        SELECT participant_id, raffle_id FROM ev
         WHERE reason = 'number_paid' AND raffle_id IS NOT NULL
         GROUP BY participant_id, raffle_id HAVING SUM(points) > 0
      ),
      r AS (SELECT participant_id, COUNT(*)::int AS raffles FROM per_raffle GROUP BY participant_id),
      per_order AS (
        SELECT participant_id, order_id FROM ev
         WHERE reason = 'number_paid' AND order_id IS NOT NULL
         GROUP BY participant_id, order_id HAVING SUM(points) > 0
      ),
      inv AS (
        SELECT po.participant_id, SUM(o.total_cop)::int AS invested
          FROM per_order po JOIN orders o ON o.id = po.order_id GROUP BY po.participant_id
      )
      SELECT t.participant_id, p.name, p.nickname, p.phone, t.points,
             COALESCE(r.raffles, 0) AS raffles, COALESCE(inv.invested, 0) AS invested, re.reached_at
        FROM totals t
        JOIN participants p ON p.id = t.participant_id
        JOIN re ON re.participant_id = t.participant_id
        LEFT JOIN r ON r.participant_id = t.participant_id
        LEFT JOIN inv ON inv.participant_id = t.participant_id
       ORDER BY ${order}`;
    return rows.map((row, i) => ({
      rank: i + 1,
      participantId: row.participant_id,
      name: row.name,
      nickname: row.nickname,
      phone: row.phone,
      points: row.points,
      raffles: row.raffles,
      investedCop: row.invested,
      reachedAt: row.reached_at,
    }));
  }

  // ---------------------------------------------------------------------------
  // Lecturas del panel
  // ---------------------------------------------------------------------------

  private presentPeriod(p: RankingPeriod) {
    return { id: p.id, label: p.label, frequency: p.frequency, status: p.status, startsAt: p.startsAt, endsAt: p.endsAt, closedAt: p.closedAt };
  }

  async current(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) => {
      const config = await this.config(tx);
      if (!config.enabled) return { enabled: false as const };
      const period = await this.periodFor(tx, org.id, new Date(), config);
      const now = await this.standings(tx, period.id, config.tiebreaker);
      const yesterday = await this.standings(tx, period.id, config.tiebreaker, new Date(Date.now() - 86_400_000));
      const prevRank = new Map(yesterday.map((s) => [s.participantId, s.rank]));
      return {
        enabled: true as const,
        period: this.presentPeriod(period),
        prizes: config.prizes,
        tiebreaker: config.tiebreaker,
        standings: now.map((s) => ({
          ...s,
          phone: ParticipantsService.phoneFor(org, s.phone),
          change: prevRank.has(s.participantId) ? prevRank.get(s.participantId)! - s.rank : null,
        })),
      };
    });
  }

  periods(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) =>
      (await tx.rankingPeriod.findMany({ orderBy: { startsAt: 'desc' }, take: 60 })).map((p) => this.presentPeriod(p)),
    );
  }

  async period(org: OrgContext, id: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const p = await tx.rankingPeriod.findFirst({ where: { id } });
      if (!p) throw Errors.notFound('el periodo');
      if (p.status === 'closed') {
        return { period: this.presentPeriod(p), standings: (p.snapshot as unknown as SnapshotRow[]) ?? [] };
      }
      const config = await this.config(tx);
      const rows = await this.standings(tx, p.id, config.tiebreaker);
      return { period: this.presentPeriod(p), standings: rows.map((s) => ({ ...s, phone: ParticipantsService.phoneFor(org, s.phone) })) };
    });
  }

  async exportCsv(org: OrgContext, id: string): Promise<string> {
    return this.db.tenantTx(org.id, async (tx) => {
      const p = await tx.rankingPeriod.findFirst({ where: { id } });
      if (!p) throw Errors.notFound('el periodo');
      const config = (p.configSnapshot as unknown as RankingSettings | null) ?? (await this.config(tx));
      const rows = await this.standings(tx, p.id, config.tiebreaker);
      await this.audit.record(tx, { action: 'ranking.export', entityType: 'ranking_period', entityId: p.id, after: { rows: rows.length } });
      const header = ['puesto', 'nombre', 'whatsapp', 'puntos', 'sorteos', 'invertido_cop'];
      const lines = rows.map((r) =>
        [r.rank, r.name, ParticipantsService.phoneFor(org, r.phone), r.points, r.raffles, r.investedCop].map(csvCell).join(','),
      );
      return `\uFEFF${[header.join(','), ...lines].join('\n')}\n`;
    });
  }

  // ---------------------------------------------------------------------------
  // Público
  // ---------------------------------------------------------------------------

  async publicRanking(organizationId: string, periodParam: string) {
    return this.db.tenantTx(organizationId, async (tx) => {
      const config = await this.config(tx);
      if (!config.enabled || !(await this.planAllowsRanking(tx, organizationId))) {
        throw Errors.conflict('RANKING_DISABLED', 'Esta organización no tiene ranking activo.');
      }
      const nameFormat = config.nameFormat as NameFormat;
      let period: RankingPeriod | null;
      if (periodParam === 'current') {
        period = await this.periodFor(tx, organizationId, new Date(), config);
      } else {
        period = await tx.rankingPeriod.findFirst({ where: { label: periodParam } });
        if (!period) throw Errors.notFound('ese periodo del ranking');
      }
      let rows: { rank: number; name: string; nickname: string | null; maskedPhone: string; points: number }[];
      if (period.status === 'closed') {
        rows = (period.snapshot as unknown as SnapshotRow[]) ?? [];
      } else {
        rows = (await this.standings(tx, period.id, config.tiebreaker)).map((s) => ({ ...s, maskedPhone: maskPhone(s.phone) }));
      }
      return {
        period: { label: period.label, status: period.status, startsAt: period.startsAt, endsAt: period.endsAt },
        closesAt: period.status === 'open' ? period.endsAt : null,
        prizes: config.prizes,
        participants: rows.length,
        top: rows.slice(0, config.publicTopSize).map((r) => ({
          rank: r.rank,
          name: displayName(r, nameFormat),
          phone: r.maskedPhone,
          points: r.points,
        })),
      };
    });
  }

  /** Posición de un participante en el periodo actual (para «Mis boletos»). */
  async positionOf(tx: Tx, organizationId: string, participantId: string) {
    const config = await this.config(tx);
    if (!config.enabled || !(await this.planAllowsRanking(tx, organizationId))) return null;
    const period = await this.periodFor(tx, organizationId, new Date(), config);
    const rows = await this.standings(tx, period.id, config.tiebreaker);
    const mine = rows.find((r) => r.participantId === participantId);
    const tenth = rows[9];
    const inTop = Boolean(mine && mine.rank <= 10);
    return {
      period: period.label,
      closesAt: period.endsAt,
      rank: mine?.rank ?? null,
      points: mine?.points ?? 0,
      pointsToTop10: inTop ? 0 : tenth ? tenth.points - (mine?.points ?? 0) + 1 : 1,
    };
  }

  /** La fase 6 conecta aquí el flag `ranking` del plan. */
  protected async planAllowsRanking(_tx: Tx, _organizationId: string): Promise<boolean> {
    return true;
  }
}
