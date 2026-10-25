import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { Errors } from '../common/errors';
import { formatDrawDate, formatTime } from '../common/dates';
import { formatCop, formatNumberList } from '../common/format';
import { displayName, type NameFormat } from '../common/privacy';
import { localDateKey, startOfLocalDay, utcToLocal } from '../common/time';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { type OrderEvent, OrderHooks } from '../orders/order-hooks';
import { RankingService, type SnapshotRow } from '../ranking/ranking.service';
import type { RankingSettings } from '../settings/schemas';
import { SettingsService } from '../settings/settings.service';
import { MessagesService } from './messages.service';

const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

/** Reglas de negocio de las notificaciones por WhatsApp. */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessagesService,
    private readonly hooks: OrderHooks,
    private readonly ranking: RankingService,
    private readonly settings: SettingsService,
  ) {}

  onModuleInit(): void {
    this.hooks.afterCommit((e) => this.onOrderEvent(e));
    this.ranking.onPeriodClosed(async ({ organizationId, periodId }) => {
      const config = await this.db.tenantTx(organizationId, (tx) => this.settings.read(tx, 'ranking'));
      if (config.data.announceOnClose) await this.rankingTop10(organizationId, periodId, 'close');
    });
  }

  private org(organizationId: string) {
    return this.db.system.organization.findUniqueOrThrow({ where: { id: organizationId } });
  }

  /** Regla 3: boleto al aprobar; aviso con el motivo al rechazar. */
  private async onOrderEvent(e: OrderEvent): Promise<void> {
    if (e.type !== 'approved' && e.type !== 'rejected') return;
    const org = await this.org(e.organizationId);
    const data = await this.db.tenantTx(e.organizationId, (tx) =>
      tx.order.findFirstOrThrow({ where: { id: e.orderId }, include: { participant: true, raffle: true, tickets: { where: { status: 'valid' } } } }),
    );
    const name = firstName(data.participant.name);
    if (e.type === 'approved') {
      await this.messages.enqueue(
        e.organizationId,
        'ticket_confirmed',
        data.participant.phone,
        {
          name,
          raffle: data.raffle.title,
          numbers: formatNumberList(data.numbers, data.raffle.digits),
          codes: data.tickets.map((t) => t.code).join(', '),
          drawAt: formatDrawDate(data.raffle.drawAt, org.timezone),
        },
        { idempotencyKey: `ticket:${e.orderId}`, participantId: data.participantId },
      );
    } else {
      await this.messages.enqueue(
        e.organizationId,
        'payment_rejected',
        data.participant.phone,
        { name, raffle: data.raffle.title, reason: e.reason ?? 'sin motivo' },
        { idempotencyKey: `rejected:${e.orderId}`, participantId: data.participantId },
      );
    }
  }

  /** Participantes con números pagados en un sorteo (uno por persona). */
  private paidParticipants(organizationId: string, raffleId: string) {
    return this.db.tenantTx(organizationId, async (tx) => {
      const orders = await tx.order.findMany({ where: { raffleId, status: 'approved' }, include: { participant: true } });
      const byParticipant = new Map<string, { phone: string; name: string; numbers: number[] }>();
      for (const o of orders) {
        const cur = byParticipant.get(o.participantId) ?? { phone: o.participant.phone, name: o.participant.name, numbers: [] };
        cur.numbers.push(...o.numbers);
        byParticipant.set(o.participantId, cur);
      }
      return byParticipant;
    });
  }

  /** P11: aviso de cancelación a quienes pagaron. */
  async raffleCancelled(organizationId: string, raffleId: string, reason: string): Promise<void> {
    const raffle = await this.db.tenantTx(organizationId, (tx) => tx.raffle.findFirstOrThrow({ where: { id: raffleId } }));
    for (const [participantId, p] of await this.paidParticipants(organizationId, raffleId)) {
      await this.messages.enqueue(
        organizationId,
        'raffle_cancelled',
        p.phone,
        { name: firstName(p.name), raffle: raffle.title, reason },
        { idempotencyKey: `cancelled:${raffleId}:${participantId}`, participantId },
      );
    }
  }

  /** draw-reminder: 2 h antes, a quienes tienen números pagados (si está activado). */
  async drawReminder(organizationId: string, raffleId: string, drawAtIso: string): Promise<number> {
    const raffle = await this.db.tenantTx(organizationId, (tx) => tx.raffle.findFirst({ where: { id: raffleId, deletedAt: null } }));
    // Job viejo (cambió la fecha) o sorteo ya jugado/cancelado: no hace nada.
    if (!raffle || raffle.drawAt.toISOString() !== drawAtIso || !['active', 'sold_out', 'closed'].includes(raffle.status)) return 0;
    const org = await this.org(organizationId);
    let sent = 0;
    for (const [participantId, p] of await this.paidParticipants(organizationId, raffleId)) {
      const id = await this.messages.enqueue(
        organizationId,
        'draw_reminder',
        p.phone,
        {
          name: firstName(p.name),
          raffle: raffle.title,
          time: formatTime(raffle.drawAt, org.timezone),
          numbers: formatNumberList(p.numbers.sort((a, b) => a - b), raffle.digits),
        },
        { idempotencyKey: `reminder:${raffleId}:${raffle.drawAt.getTime()}:${participantId}`, participantId },
      );
      if (id) sent++;
    }
    return sent;
  }

  /** «Avísame del próximo sorteo» al publicar. */
  async raffleAnnounced(organizationId: string, raffleId: string): Promise<number> {
    const org = await this.org(organizationId);
    const { raffle, subs } = await this.db.tenantTx(organizationId, async (tx) => ({
      raffle: await tx.raffle.findFirstOrThrow({ where: { id: raffleId } }),
      subs: await tx.notifyMeSubscription.findMany({ where: { unsubscribedAt: null } }),
    }));
    const participants = await this.db.tenantTx(organizationId, (tx) =>
      tx.participant.findMany({ where: { id: { in: subs.map((s) => s.participantId) } } }),
    );
    let sent = 0;
    for (const p of participants) {
      const id = await this.messages.enqueue(
        organizationId,
        'new_raffle',
        p.phone,
        { name: firstName(p.name), org: org.name, raffle: raffle.title, link: `${env().PUBLIC_BASE_URL}/${org.slug}/${raffle.slug}` },
        { idempotencyKey: `new-raffle:${raffleId}:${p.id}`, participantId: p.id },
      );
      if (id) sent++;
    }
    if (sent > 0) {
      await this.db.tenantTx(organizationId, (tx) =>
        tx.notifyMeSubscription.updateMany({ where: { participantId: { in: participants.map((p) => p.id) } }, data: { lastNotifiedAt: new Date() } }),
      );
    }
    return sent;
  }

  /** Acción manual: avisar a los ganadores (verifica plan y cuota: 402). */
  async notifyWinners(organizationId: string, raffleId: string): Promise<{ queued: number }> {
    const { raffle, winners } = await this.db.tenantTx(organizationId, async (tx) => {
      const raffle = await tx.raffle.findFirst({ where: { id: raffleId, deletedAt: null } });
      if (!raffle) throw Errors.notFound('el sorteo');
      if (!raffle.resultsPublishedAt) throw Errors.conflict('RESULTS_NOT_PUBLISHED', 'Publica los resultados antes de avisar a los ganadores.');
      const winners = await tx.winner.findMany({ where: { raffleId, unsold: false }, include: { participant: true, prize: true } });
      return { raffle, winners };
    });
    await this.messages.assertCanNotify(organizationId, winners.length);
    let queued = 0;
    for (const w of winners) {
      const id = await this.messages.enqueue(
        organizationId,
        'winner_notice',
        w.participant!.phone,
        {
          name: firstName(w.participant!.name),
          raffle: raffle.title,
          number: String(w.number).padStart(raffle.digits, '0'),
          prize: w.prize.amountCop ? formatCop(w.prize.amountCop) : (w.prize.description ?? 'Premio'),
        },
        { idempotencyKey: `winner:${w.id}`, participantId: w.participantId },
      );
      if (id) queued++;
    }
    await this.db.tenantTx(organizationId, (tx) => tx.drawResult.updateMany({ where: { raffleId }, data: { winnersNotifiedAt: new Date() } }));
    return { queued };
  }

  /**
   * Top 10 por WhatsApp a los participantes del periodo: al cerrar (si
   * `announceOnClose`) o a mano desde el panel.
   */
  async rankingTop10(organizationId: string, periodId: string, mode: 'close' | 'manual'): Promise<{ queued: number }> {
    const org = await this.org(organizationId);
    const { period, rows, config } = await this.db.tenantTx(organizationId, async (tx) => {
      const period = await tx.rankingPeriod.findFirst({ where: { id: periodId } });
      if (!period) throw Errors.notFound('el periodo');
      const config: RankingSettings = (await this.settings.read(tx, 'ranking')).data;
      const rows: (Pick<SnapshotRow, 'rank' | 'name' | 'nickname' | 'points' | 'participantId'> & { phone?: string })[] =
        period.status === 'closed'
          ? ((period.snapshot as unknown as SnapshotRow[]) ?? [])
          : await this.ranking.standings(tx, period.id, config.tiebreaker);
      return { period, rows, config };
    });
    const top = rows
      .slice(0, 10)
      .map((r) => `${r.rank}. ${displayName(r, config.nameFormat as NameFormat)} (${r.points})`)
      .join(' · ');
    const recipients = await this.db.tenantTx(organizationId, (tx) =>
      tx.participant.findMany({ where: { id: { in: rows.map((r) => r.participantId) } } }),
    );
    if (mode === 'manual') await this.messages.assertCanNotify(organizationId, recipients.length);
    const stamp = mode === 'close' ? 'close' : localDateKey(new Date(), org.timezone);
    let queued = 0;
    for (const p of recipients) {
      const id = await this.messages.enqueue(
        organizationId,
        'ranking_top10',
        p.phone,
        { org: org.name, period: period.label, top },
        { idempotencyKey: `ranking:${period.id}:${stamp}:${p.id}`, participantId: p.id },
      );
      if (id) queued++;
    }
    await this.db.tenantTx(organizationId, (tx) => tx.rankingPeriod.update({ where: { id: period.id }, data: { announcedAt: new Date() } }));
    return { queued };
  }

  /** daily-digest: a las 8:00 p. m. hora local, al WhatsApp de soporte del organizador. Idempotente por día. */
  async dailyDigest(now = new Date()): Promise<number> {
    const enabled = await this.db.system.orgSettings.findMany({
      where: { section: 'notifications', data: { path: ['dailyDigest'], equals: true } },
      include: { organization: true },
    });
    let sent = 0;
    for (const { organization: org } of enabled) {
      if (!org.supportWhatsapp || org.status === 'suspended') continue;
      if (utcToLocal(now, org.timezone).getHours() < 20) continue;
      const day = localDateKey(now, org.timezone);
      const run = await this.db.system.$queryRaw<{ job: string }[]>`
        INSERT INTO job_runs (job, key, completed_at) VALUES ('daily-digest', ${`${org.id}:${day}`}, now())
        ON CONFLICT DO NOTHING RETURNING job`;
      if (run.length === 0) continue;
      const since = startOfLocalDay(now, org.timezone);
      const stats = await this.db.tenantTx(org.id, async (tx) => ({
        approved: await tx.order.aggregate({ where: { status: 'approved', verifiedAt: { gte: since } }, _sum: { totalCop: true }, _count: true }),
        pending: await tx.order.count({ where: { status: 'pending_verification' } }),
      }));
      const id = await this.messages.enqueue(
        org.id,
        'daily_digest',
        org.supportWhatsapp,
        {
          org: org.name,
          date: day,
          collected: formatCop(stats.approved._sum.totalCop ?? 0),
          approved: String(stats.approved._count),
          pending: String(stats.pending),
        },
        { idempotencyKey: `digest:${org.id}:${day}` },
      );
      if (id) sent++;
    }
    return sent;
  }
}
