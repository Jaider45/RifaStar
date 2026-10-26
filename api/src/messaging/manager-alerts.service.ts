import { Injectable, Logger } from '@nestjs/common';
import type { DrawResult, LotteryResult, Raffle } from '@prisma/client';
import { MailProvider } from '../auth/mail/mail.provider';
import {
  managerDeliveryReminderMail,
  managerLotteryResultMail,
  managerWinnersMail,
} from '../auth/mail/templates';
import { formatCop, formatNumber } from '../common/format';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import { composeFullNumber, type Digits } from '../results/winner-rules';
import { SettingsService } from '../settings/settings.service';
import { MessagesService } from './messages.service';

export interface Manager {
  userId: string;
  name: string;
  email: string;
  /** WhatsApp verificado (E.164) o null. */
  phone: string | null;
}

/** El parámetro de una plantilla de WhatsApp no puede ser muy largo. */
const MAX_PARAM = 900;

const LOTTERY_STATUS: Record<LotteryResult['status'], string> = {
  confirmed: 'verificado',
  preliminary: 'sin verificar',
  disputed: 'en discusión',
};

/**
 * Avisos al equipo organizador (punto 2): el resultado que reporta LoteríaYa y los
 * ganadores calculados, por WhatsApp y correo, a todos los gestores (miembros con
 * permiso de anunciar ganadores). Cada aviso sale una sola vez por dato o revisión.
 */
@Injectable()
export class ManagerAlertsService {
  private readonly logger = new Logger(ManagerAlertsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly messages: MessagesService,
    private readonly mail: MailProvider,
    private readonly permissions: PermissionsService,
    private readonly settings: SettingsService,
  ) {}

  /** Gestores de la organización: miembros activos con permiso `winners.announce`. */
  async managers(organizationId: string): Promise<Manager[]> {
    const members = await this.db.system.member.findMany({
      where: { organizationId, status: 'active', role: { deletedAt: null } },
      include: { user: true, role: { include: { permissions: true } } },
    });
    return members
      .filter((m) => this.permissions.roleKeys(m.role.key, m.role.organizationId, m.role.permissions).has('winners.announce'))
      .map((m) => ({
        userId: m.userId,
        name: m.user.name,
        email: m.user.email,
        phone: m.user.phoneVerifiedAt ? m.user.phone : null,
      }));
  }

  /** Marca una clave como enviada. Devuelve false si ya se había enviado (idempotencia entre procesos). */
  private async claimOnce(job: string, key: string): Promise<boolean> {
    const rows = await this.db.system.$queryRaw<{ job: string }[]>`
      INSERT INTO job_runs (job, key, completed_at) VALUES (${job}, ${key}, now())
      ON CONFLICT DO NOTHING RETURNING job`;
    return rows.length === 1;
  }

  private async enabled(organizationId: string, key: 'managerAlerts' | 'deliveryReminder'): Promise<boolean> {
    const n = await this.db.tenantTx(organizationId, (tx) => this.settings.read(tx, 'notifications'));
    return n.data[key];
  }

  private link(raffleId: string) {
    return `${env().PUBLIC_BASE_URL}/admin/ganadores/${raffleId}`;
  }

  private async sendAll(
    organizationId: string,
    managers: Manager[],
    baseKey: string,
    whatsapp: (m: Manager) => Promise<unknown>,
    email: (m: Manager) => ReturnType<typeof managerWinnersMail>,
  ): Promise<number> {
    let sent = 0;
    for (const m of managers) {
      if (m.phone) {
        await whatsapp(m).catch((err) => this.logger.warn(`WhatsApp a gestor falló (${baseKey}): ${String(err)}`));
      }
      await this.mail
        .send(email(m))
        .then(() => sent++)
        .catch((err) => this.logger.warn(`Correo a gestor falló (${baseKey}): ${String(err)}`));
    }
    this.logger.log(`Aviso a gestores ${baseKey}: ${managers.length} destinatarios (org ${organizationId})`);
    return sent;
  }

  /** «4058 · serie 127 → 40587» para sorteos de 5 y 6 cifras; «4058» para el resto. */
  static resultLabel(raffle: Pick<Raffle, 'digits' | 'extraDigitsSource' | 'extraDigitsPosition'>, r: Pick<DrawResult, 'mainResult' | 'seriesResult' | 'fifthDigit' | 'anticipatedResult'>): string {
    let label = r.mainResult;
    if (raffle.digits >= 5) {
      const extra = raffle.extraDigitsSource === 'fifth_digit' ? `quinta cifra ${r.fifthDigit ?? '?'}` : `serie ${r.seriesResult ?? '???'}`;
      let full = '?';
      try {
        full = composeFullNumber(
          raffle.digits as Digits,
          r.mainResult,
          { source: raffle.extraDigitsSource, position: raffle.extraDigitsPosition },
          { series: r.seriesResult, fifthDigit: r.fifthDigit },
        );
      } catch {
        /* datos incompletos: se muestra «?» */
      }
      label = `${r.mainResult} · ${extra} → ${full}`;
    }
    if (r.anticipatedResult) label += ` · anticipado ${r.anticipatedResult}`;
    return label;
  }

  /**
   * LoteríaYa publicó (o corrigió) el resultado de la lotería del sorteo. Se informa;
   * el equipo lo ingresa a mano. Una corrección del dato genera un aviso nuevo.
   */
  async lotteryResult(organizationId: string, raffleId: string, lr: LotteryResult, anticipated?: LotteryResult | null): Promise<number> {
    if (!(await this.enabled(organizationId, 'managerAlerts'))) return 0;
    const { org, raffle } = await this.db.tenantTx(organizationId, async (tx) => ({
      org: await tx.organization.findUniqueOrThrow({ where: { id: organizationId } }),
      raffle: await tx.raffle.findFirstOrThrow({ where: { id: raffleId } }),
    }));
    const parts = [lr.winningNumber ?? '—'];
    if (lr.winningSeries) parts.push(`serie ${lr.winningSeries}`);
    if (lr.fifthDigit) parts.push(`quinta cifra ${lr.fifthDigit}`);
    if (anticipated?.winningNumber) parts.push(`anticipado ${anticipated.drawName}: ${anticipated.winningNumber}`);
    const result = parts.join(' · ');
    const status = LOTTERY_STATUS[lr.status];
    const key = `${raffleId}:${lr.drawCode}:${result}:${lr.status}`;
    if (!(await this.claimOnce('manager-lottery-result', key))) return 0;

    const managers = await this.managers(organizationId);
    const vars = { raffle: raffle.title, lottery: lr.drawName, result, status, link: this.link(raffleId) };
    const sent = await this.sendAll(
      organizationId,
      managers,
      `lottery:${key}`,
      (m) => this.messages.enqueue(organizationId, 'manager_lottery_result', m.phone!, vars, { idempotencyKey: `mgr-lottery:${key}:${m.userId}` }),
      (m) => managerLotteryResultMail(m.email, { org: org.name, ...vars }),
    );
    await this.db.tenantTx(organizationId, (tx) => tx.raffle.update({ where: { id: raffleId }, data: { lotteryResultNotifiedAt: new Date() } }));
    return sent;
  }

  /** Ganadores calculados tras ingresar o corregir el resultado (una vez por revisión). */
  async winnersComputed(organizationId: string, raffleId: string): Promise<number> {
    if (!(await this.enabled(organizationId, 'managerAlerts'))) return 0;
    const data = await this.db.tenantTx(organizationId, async (tx) => {
      const raffle = await tx.raffle.findFirstOrThrow({ where: { id: raffleId }, include: { drawResult: true, prizes: { orderBy: { position: 'asc' } } } });
      const winners = await tx.winner.findMany({ where: { raffleId }, include: { participant: true } });
      return { org: await tx.organization.findUniqueOrThrow({ where: { id: organizationId } }), raffle, winners };
    });
    const result = data.raffle.drawResult;
    if (!result || (result.managersNotifiedRevision ?? 0) >= result.revision) return 0;
    if (!(await this.claimOnce('manager-winners', `${raffleId}:${result.revision}`))) return 0;

    // El equipo organizador sí ve el WhatsApp completo: lo necesita para contactar al ganador.
    const lines = data.raffle.prizes.flatMap((p) => {
      const prize = p.amountCop ? formatCop(p.amountCop) : (p.description ?? 'Premio');
      const rows = data.winners.filter((w) => w.prizeId === p.id);
      if (rows.length === 0) return [`${prize}: pendiente (falta el anticipado o el número del premio especial)`];
      return rows.map((w) =>
        w.unsold
          ? `${prize}: ${formatNumber(w.number, data.raffle.digits)} — No vendido`
          : `${prize}: ${formatNumber(w.number, data.raffle.digits)} — ${w.participant!.name}, ${w.participant!.phone}`,
      );
    });
    const label = ManagerAlertsService.resultLabel(data.raffle, result);
    const short = lines.join(' | ');
    const sent = await this.sendAll(
      organizationId,
      await this.managers(organizationId),
      `winners:${raffleId}:${result.revision}`,
      (m) =>
        this.messages.enqueue(
          organizationId,
          'manager_winners',
          m.phone!,
          { raffle: data.raffle.title, result: label, winners: short.length > MAX_PARAM ? `${short.slice(0, MAX_PARAM - 30)}… (ver todos en el panel)` : short, link: this.link(raffleId) },
          { idempotencyKey: `mgr-winners:${raffleId}:${result.revision}:${m.userId}` },
        ),
      (m) => managerWinnersMail(m.email, { org: data.org.name, raffle: data.raffle.title, result: label, lines, link: this.link(raffleId) }),
    );
    await this.db.tenantTx(organizationId, (tx) =>
      tx.drawResult.update({ where: { raffleId }, data: { managersNotifiedRevision: result.revision } }),
    );
    return sent;
  }

  /**
   * delivery-reminder (si la organización lo activa): premios con ganador sin marcar como
   * entregados pasadas N horas del resultado. Repite cada N horas mientras sigan pendientes.
   */
  async deliveryReminders(now = new Date()): Promise<number> {
    const orgs = await this.db.system.orgSettings.findMany({
      where: { section: 'notifications', data: { path: ['deliveryReminder'], equals: true } },
      include: { organization: true },
    });
    let reminded = 0;
    for (const { organization: org } of orgs) {
      if (org.status === 'suspended') continue;
      const hours = (await this.db.tenantTx(org.id, (tx) => this.settings.read(tx, 'notifications'))).data.deliveryReminderHours;
      const cutoff = new Date(now.getTime() - hours * 3_600_000);
      const pending = await this.db.tenantTx(org.id, (tx) =>
        tx.winner.findMany({
          where: {
            unsold: false,
            deliveryStatus: 'pending',
            drawResult: { enteredAt: { lte: cutoff } },
            OR: [{ reminderSentAt: null }, { reminderSentAt: { lte: cutoff } }],
          },
          include: { participant: true, prize: true, raffle: true },
        }),
      );
      const byRaffle = new Map<string, typeof pending>();
      for (const w of pending) byRaffle.set(w.raffleId, [...(byRaffle.get(w.raffleId) ?? []), w]);
      const managers = byRaffle.size > 0 ? await this.managers(org.id) : [];
      for (const [raffleId, rows] of byRaffle) {
        const raffle = rows[0].raffle;
        const stamp = Math.floor(now.getTime() / (hours * 3_600_000));
        if (!(await this.claimOnce('manager-delivery-reminder', `${raffleId}:${stamp}`))) continue;
        const lines = rows.map(
          (w) =>
            `${w.prize.amountCop ? formatCop(w.prize.amountCop) : (w.prize.description ?? 'Premio')}: ` +
            `${formatNumber(w.number, raffle.digits)} — ${w.participant!.name}, ${w.participant!.phone}`,
        );
        const pendingText = rows.length === 1 ? '1 premio' : `${rows.length} premios`;
        await this.sendAll(
          org.id,
          managers,
          `reminder:${raffleId}:${stamp}`,
          (m) =>
            this.messages.enqueue(
              org.id,
              'manager_delivery_reminder',
              m.phone!,
              { raffle: raffle.title, pending: pendingText, link: this.link(raffleId) },
              { idempotencyKey: `mgr-reminder:${raffleId}:${stamp}:${m.userId}` },
            ),
          (m) => managerDeliveryReminderMail(m.email, { org: org.name, raffle: raffle.title, lines, link: this.link(raffleId) }),
        );
        await this.db.tenantTx(org.id, (tx) =>
          tx.winner.updateMany({ where: { id: { in: rows.map((w) => w.id) } }, data: { reminderSentAt: now } }),
        );
        reminded++;
      }
    }
    return reminded;
  }
}
