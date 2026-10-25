import { Injectable, Logger } from '@nestjs/common';
import type { MessageStatus, Prisma } from '@prisma/client';
import { Errors } from '../common/errors';
import { localMonthKey } from '../common/time';
import { DatabaseService } from '../database/database.service';
import { JOB } from '../jobs/jobs.constants';
import { SchedulerService } from '../jobs/scheduler.service';
import { PlanPolicyService } from '../plans/plan-policy.service';
import { SettingsService } from '../settings/settings.service';
import { MessagingError, MessagingProvider } from './messaging.provider';
import { type TemplateKey, TEMPLATES, type TemplateVars } from './templates';

export interface EnqueueOptions {
  idempotencyKey: string;
  participantId?: string | null;
}

const STATUS_ORDER: MessageStatus[] = ['queued', 'sent', 'delivered', 'read'];

/**
 * Envío de WhatsApp: registro en MessageLog, idempotencia por clave, cuota
 * del plan (P6) y cola `send-whatsapp` con reintentos exponenciales.
 */
@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly provider: MessagingProvider,
    private readonly plans: PlanPolicyService,
    private readonly scheduler: SchedulerService,
    private readonly settings: SettingsService,
  ) {}

  /**
   * Encola un mensaje si su ajuste está activo y el plan lo permite. Devuelve
   * el id del registro, o null si no corresponde enviarlo. Idempotente.
   */
  async enqueue<K extends TemplateKey>(
    organizationId: string,
    template: K,
    to: string,
    vars: TemplateVars<K>,
    opts: EnqueueOptions,
  ): Promise<string | null> {
    const def = TEMPLATES[template];
    if (template !== 'otp_code' && !(await this.plans.hasFeature(organizationId, 'whatsappAutomation'))) return null;

    const org = await this.db.system.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    const inserted = await this.db.tenantTx(organizationId, async (tx) => {
      if (def.setting) {
        const notifications = await this.settings.read(tx, 'notifications');
        if (!notifications.data[def.setting]) return null;
      }
      const rows = await tx.$queryRaw<{ id: string }[]>`
        INSERT INTO message_logs (id, organization_id, template, channel, to_phone, participant_id, variables, status, provider, quota_units, quota_period, idempotency_key, created_at)
        VALUES (gen_random_uuid(), ${organizationId}::uuid, ${template}, 'whatsapp', ${to}, ${opts.participantId ?? null}::uuid,
                ${JSON.stringify(vars)}::jsonb, 'queued', 'meta_cloud', 1, ${localMonthKey(new Date(), org.timezone)},
                ${opts.idempotencyKey}, now())
        ON CONFLICT (idempotency_key) DO NOTHING
        RETURNING id`;
      return rows[0]?.id ?? null;
    });
    if (inserted) await this.scheduler.messages.add(JOB.sendWhatsapp, { messageId: inserted }, { jobId: inserted });
    return inserted;
  }

  /** Reserva cuota. Las transaccionales pueden pasarse del límite; las promocionales no. */
  private async reserveQuota(organizationId: string, period: string, units: number, allowOverage: boolean): Promise<boolean> {
    const limit = await this.plans.whatsappLimit(organizationId);
    if (!allowOverage && units > limit) return false;
    const rows = await this.db.system.$queryRaw<{ used: number }[]>`
      INSERT INTO usage_counters (organization_id, metric, period, used, updated_at)
      VALUES (${organizationId}::uuid, 'whatsapp_messages', ${period}, ${units}, now())
      ON CONFLICT (organization_id, metric, period) DO UPDATE
        SET used = usage_counters.used + EXCLUDED.used, updated_at = now()
        WHERE ${allowOverage} OR usage_counters.used + EXCLUDED.used <= ${limit}
      RETURNING used`;
    return rows.length === 1;
  }

  private async refundQuota(organizationId: string, period: string, units: number): Promise<void> {
    await this.db.system.$executeRaw`
      UPDATE usage_counters SET used = GREATEST(used - ${units}, 0), updated_at = now()
       WHERE organization_id = ${organizationId}::uuid AND metric = 'whatsapp_messages' AND period = ${period}`;
  }

  /** Procesador de send-whatsapp. Lanza en errores transitorios para que BullMQ reintente. */
  async process(messageId: string): Promise<MessageStatus | 'skipped'> {
    const m = await this.db.system.messageLog.findUnique({ where: { id: messageId } });
    if (!m || m.status !== 'queued') return 'skipped';
    const orgId = m.organizationId!;
    const def = TEMPLATES[m.template as TemplateKey];

    if (m.attempts === 0) {
      const ok = await this.reserveQuota(orgId, m.quotaPeriod, m.quotaUnits, def.kind === 'transactional');
      if (!ok) {
        await this.db.system.messageLog.update({ where: { id: m.id }, data: { status: 'skipped_quota', error: 'Cuota mensual agotada' } });
        return 'skipped_quota';
      }
    }
    await this.db.system.messageLog.update({ where: { id: m.id }, data: { attempts: { increment: 1 } } });

    const vars = m.variables as never;
    try {
      const { providerMessageId } = await this.provider.sendTemplate({
        to: m.toPhone,
        template: def.meta,
        language: 'es',
        bodyParams: def.params(vars),
        preview: def.preview(vars),
      });
      await this.db.system.messageLog.update({
        where: { id: m.id },
        data: { status: 'sent', providerMessageId, sentAt: new Date(), error: null },
      });
      return 'sent';
    } catch (err) {
      const permanent = err instanceof MessagingError && err.permanent;
      if (permanent) {
        await this.markFailed(m.id, (err as Error).message);
        return 'failed';
      }
      await this.db.system.messageLog.update({ where: { id: m.id }, data: { error: (err as Error).message.slice(0, 500) } });
      throw err;
    }
  }

  /** Falla definitiva: se devuelve la cuota (el proveedor no cobra lo que no se envía). */
  async markFailed(messageId: string, error: string): Promise<void> {
    const m = await this.db.system.messageLog.findUnique({ where: { id: messageId } });
    if (!m || m.status !== 'queued') return;
    await this.db.system.messageLog.update({ where: { id: m.id }, data: { status: 'failed', error: error.slice(0, 500) } });
    if (m.attempts > 0) await this.refundQuota(m.organizationId!, m.quotaPeriod, m.quotaUnits);
    this.logger.warn(`WhatsApp ${m.template} a ***${m.toPhone.slice(-4)} falló: ${error}`);
  }

  /** Cuota restante del mes en curso. */
  async remainingQuota(organizationId: string): Promise<{ limit: number; used: number; remaining: number; period: string }> {
    const org = await this.db.system.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { timezone: true } });
    const period = localMonthKey(new Date(), org.timezone);
    const limit = await this.plans.whatsappLimit(organizationId);
    const counter = await this.db.system.usageCounter.findUnique({
      where: { organizationId_metric_period: { organizationId, metric: 'whatsapp_messages', period } },
    });
    const used = counter?.used ?? 0;
    return { limit, used, remaining: Math.max(limit - used, 0), period };
  }

  /** Para acciones manuales de «avisar»: 402 si el plan no lo permite o no alcanza la cuota. */
  async assertCanNotify(organizationId: string, count: number): Promise<void> {
    if (!(await this.plans.hasFeature(organizationId, 'whatsappAutomation'))) {
      throw Errors.planLimit('PLAN_FEATURE_WHATSAPP_AUTOMATION', 'Tu plan no incluye notificaciones por WhatsApp. Mejora tu plan para usarlas.');
    }
    const quota = await this.remainingQuota(organizationId);
    if (quota.remaining < count) {
      throw Errors.planLimit(
        'PLAN_QUOTA_WHATSAPP',
        `No te alcanzan los mensajes del mes: necesitas ${count} y te quedan ${quota.remaining}.`,
        { needed: count, ...quota },
      );
    }
  }

  /** Estados del webhook de Meta (sent, delivered, read, failed). Solo avanza. */
  async applyStatuses(statuses: { id: string; status: string; timestamp?: string; errors?: { title?: string }[] }[]): Promise<number> {
    let updated = 0;
    for (const s of statuses) {
      const m = await this.db.system.messageLog.findUnique({ where: { providerMessageId: s.id } });
      if (!m) continue;
      const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
      let data: Prisma.MessageLogUpdateInput | null = null;
      if (s.status === 'failed') {
        if (m.status !== 'failed') data = { status: 'failed', error: s.errors?.[0]?.title ?? 'Falló la entrega' };
      } else if (STATUS_ORDER.includes(s.status as MessageStatus)) {
        const next = s.status as MessageStatus;
        if (STATUS_ORDER.indexOf(next) > STATUS_ORDER.indexOf(m.status)) {
          data = { status: next, ...(next === 'delivered' && { deliveredAt: at }), ...(next === 'read' && { readAt: at }) };
        }
      }
      if (data) {
        await this.db.system.messageLog.update({ where: { id: m.id }, data });
        updated++;
      }
    }
    return updated;
  }
}
