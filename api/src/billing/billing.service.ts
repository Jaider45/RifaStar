import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError, Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { MessagesService } from '../messaging/messages.service';
import { PlanPolicyService } from '../plans/plan-policy.service';
import type { OrgContext } from '../tenancy/org-context';
import { BillingProvider, type BillingWebhookEvent } from './billing.provider';

/** Motivo con el que billing-sync suspende; solo esas suspensiones se levantan solas al pagar. */
export const BILLING_SUSPENSION_REASON = 'Pago vencido';

const system = <T>(requestId: string, fn: () => Promise<T>) =>
  requestContext.run({ requestId, actor: { type: 'system', id: null } }, fn);

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly provider: BillingProvider,
    private readonly plans: PlanPolicyService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
  ) {}

  // ---------------------------------------------------------------------------
  // Panel del organizador
  // ---------------------------------------------------------------------------

  async overview(org: OrgContext) {
    const sub = await this.plans.subscriptionOf(org.id);
    const plan = await this.plans.planOf(org.id);
    const usage = await this.db.tenantTx(org.id, (tx) => this.plans.usage(tx, org.id));
    const whatsapp = await this.messages.remainingQuota(org.id);
    const invoices = await this.db.tenantTx(org.id, (tx) => tx.invoice.findMany({ orderBy: { createdAt: 'desc' }, take: 12 }));
    return {
      status: org.status,
      plan: { code: plan.code, name: plan.name, monthlyPriceCop: plan.monthlyPriceCop },
      subscription: sub && {
        status: sub.status,
        provider: sub.provider,
        trialEndsAt: sub.trialEndsAt,
        currentPeriodEnd: sub.currentPeriodEnd,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        pastDueSince: sub.pastDueSince,
      },
      usage: { ...usage, whatsappMessages: { used: whatsapp.used, limit: whatsapp.limit, period: whatsapp.period } },
      invoices: invoices.map((i) => ({ id: i.id, amountCop: i.amountCop, status: i.status, paidAt: i.paidAt, attemptedAt: i.attemptedAt, failureReason: i.failureReason })),
    };
  }

  async catalog() {
    const plans = await this.db.system.plan.findMany({ where: { archivedAt: null }, orderBy: [{ sortOrder: 'asc' }, { monthlyPriceCop: 'asc' }] });
    return plans.map((p) => ({
      code: p.code,
      name: p.name,
      monthlyPriceCop: p.monthlyPriceCop,
      highlighted: p.highlighted,
      purchasable: Boolean((p.externalPriceIds as Record<string, string>)[this.provider.kind]),
      limits: { activeRaffles: p.maxActiveRaffles, members: p.maxMembers, whatsappMessages: p.monthlyWhatsappMessages },
      features: {
        ranking: p.featureRanking,
        whatsappAutomation: p.featureWhatsappAuto,
        sellers: p.featureSellers,
        customRoles: p.featureCustomRoles,
        customDomain: p.featureCustomDomain,
        whiteLabel: p.featureWhiteLabel,
      },
    }));
  }

  async checkout(org: OrgContext, planCode: string, userEmail: string) {
    const plan = await this.db.system.plan.findUnique({ where: { code: planCode } });
    if (!plan || plan.archivedAt) throw Errors.validation({ field: 'planCode' }, 'Ese plan no existe.');
    const priceId = (plan.externalPriceIds as Record<string, string>)[this.provider.kind];
    if (!priceId) throw new AppError('PLAN_NOT_PURCHASABLE', 409, 'Este plan todavía no se puede comprar en línea. Escríbenos a soporte.');
    const sub = await this.plans.subscriptionOf(org.id);
    return this.provider.createCheckout({
      organizationId: org.id,
      priceId,
      customerEmail: userEmail,
      customerId: sub?.provider === this.provider.kind ? sub.externalCustomerId : null,
      successUrl: `${env().PUBLIC_BASE_URL}/admin/ajustes?pago=ok`,
      cancelUrl: `${env().PUBLIC_BASE_URL}/admin/ajustes?pago=cancelado`,
    });
  }

  async portal(org: OrgContext) {
    const sub = await this.plans.subscriptionOf(org.id);
    if (!sub?.externalCustomerId || sub.provider !== this.provider.kind) {
      throw Errors.conflict('NO_BILLING_ACCOUNT', 'Aún no tienes una suscripción con tarjeta. Elige un plan primero.');
    }
    return this.provider.createPortal(sub.externalCustomerId, `${env().PUBLIC_BASE_URL}/admin/ajustes`);
  }

  // ---------------------------------------------------------------------------
  // Webhooks y billing-sync
  // ---------------------------------------------------------------------------

  /** Guarda el evento (idempotente). Devuelve el id si es nuevo. */
  async receiveWebhook(rawBody: Buffer, signature: string | undefined): Promise<string | null> {
    let event: BillingWebhookEvent;
    try {
      event = this.provider.parseWebhook(rawBody, signature);
    } catch {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 401, 'Firma del webhook inválida.');
    }
    const rows = await this.db.system.$queryRaw<{ id: string }[]>`
      INSERT INTO billing_events (id, provider, external_event_id, type, payload, received_at)
      VALUES (gen_random_uuid(), ${this.provider.kind}::"BillingProviderKind", ${event.id}, ${event.type},
              ${JSON.stringify(event)}::jsonb, now())
      ON CONFLICT (provider, external_event_id) DO NOTHING
      RETURNING id`;
    return rows[0]?.id ?? null;
  }

  /** billing-sync: aplica un evento guardado. Idempotente (processed_at). */
  async processEvent(billingEventId: string): Promise<void> {
    const row = await this.db.system.billingEvent.findUnique({ where: { id: billingEventId } });
    if (!row || row.processedAt) return;
    const event = row.payload as unknown as BillingWebhookEvent;
    try {
      await system(`billing-${row.id}`, async () => {
        if (event.kind === 'subscription') await this.applySubscription(event);
        if (event.kind === 'invoice') await this.applyInvoice(event);
      });
      await this.db.system.billingEvent.update({ where: { id: row.id }, data: { processedAt: new Date(), attempts: { increment: 1 }, lastError: null } });
    } catch (err) {
      await this.db.system.billingEvent.update({
        where: { id: row.id },
        data: { attempts: { increment: 1 }, lastError: (err as Error).message.slice(0, 500) },
      });
      throw err;
    }
  }

  private async applySubscription(e: Extract<BillingWebhookEvent, { kind: 'subscription' }>) {
    const existing = await this.db.system.subscription.findUnique({
      where: { provider_externalSubscriptionId: { provider: this.provider.kind, externalSubscriptionId: e.externalSubscriptionId } },
    });
    const organizationId = existing?.organizationId ?? e.organizationId;
    if (!organizationId) throw new Error(`Suscripción ${e.externalSubscriptionId} sin organización`);
    const plan = e.priceId
      ? await this.db.system.plan.findFirst({ where: { externalPriceIds: { path: [this.provider.kind], equals: e.priceId } } })
      : null;

    await this.db.system.$transaction(async (tx) => {
      const data = {
        status: e.status,
        externalCustomerId: e.externalCustomerId,
        currentPeriodStart: e.periodStart,
        currentPeriodEnd: e.periodEnd,
        cancelAtPeriodEnd: e.cancelAtPeriodEnd,
        ...(plan && { planId: plan.id }),
        ...(e.status === 'canceled' && { canceledAt: new Date() }),
        ...(e.status === 'active' && { pastDueSince: null }),
        ...(e.status === 'past_due' && !existing?.pastDueSince && { pastDueSince: new Date() }),
      };
      if (existing) {
        await tx.subscription.update({ where: { id: existing.id }, data });
      } else {
        if (!plan) throw new Error(`Precio ${e.priceId} sin plan asociado`);
        // La nueva suscripción reemplaza a la vigente (prueba o manual).
        await tx.subscription.updateMany({
          where: { organizationId, status: { not: 'canceled' } },
          data: { status: 'canceled', canceledAt: new Date() },
        });
        await tx.subscription.create({
          data: { ...data, organizationId, planId: plan.id, provider: this.provider.kind, externalSubscriptionId: e.externalSubscriptionId },
        });
      }
      await this.syncOrgStatus(tx, organizationId, e.status);
    });
  }

  private async applyInvoice(e: Extract<BillingWebhookEvent, { kind: 'invoice' }>) {
    if (!e.externalSubscriptionId) return;
    const sub = await this.db.system.subscription.findUnique({
      where: { provider_externalSubscriptionId: { provider: this.provider.kind, externalSubscriptionId: e.externalSubscriptionId } },
    });
    if (!sub) throw new Error(`Factura de una suscripción desconocida (${e.externalSubscriptionId})`);
    await this.db.system.$transaction(async (tx) => {
      const now = new Date();
      await tx.invoice.upsert({
        where: { provider_externalId: { provider: this.provider.kind, externalId: e.externalInvoiceId } },
        create: {
          organizationId: sub.organizationId,
          subscriptionId: sub.id,
          provider: this.provider.kind,
          externalId: e.externalInvoiceId,
          amountCop: e.amountCop,
          status: e.paid ? 'paid' : 'failed',
          attemptedAt: now,
          paidAt: e.paid ? now : null,
          failureReason: e.failureReason,
          periodStart: e.periodStart,
          periodEnd: e.periodEnd,
        },
        update: { status: e.paid ? 'paid' : 'failed', attemptedAt: now, paidAt: e.paid ? now : null, failureReason: e.failureReason },
      });
      const status = e.paid ? 'active' : 'past_due';
      await tx.subscription.update({
        where: { id: sub.id },
        data: { status, ...(e.paid ? { pastDueSince: null } : !sub.pastDueSince ? { pastDueSince: now } : {}) },
      });
      await this.syncOrgStatus(tx, sub.organizationId, status);
    });
  }

  /** Estado de la org según la suscripción (P7). Una suspensión manual no se levanta sola. */
  private async syncOrgStatus(tx: Prisma.TransactionClient, organizationId: string, subStatus: string) {
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
    let next = org.status;
    if (subStatus === 'active' || subStatus === 'trialing') {
      if (org.status !== 'suspended' || org.suspensionReason === BILLING_SUSPENSION_REASON) next = subStatus === 'active' ? 'active' : 'trial';
    } else if (subStatus === 'past_due') {
      if (org.status === 'active' || org.status === 'trial') next = 'past_due';
    } else if (subStatus === 'canceled') {
      next = 'suspended';
    }
    if (next === org.status) return;
    await tx.organization.update({
      where: { id: organizationId },
      data: {
        status: next,
        ...(next === 'suspended'
          ? { suspendedAt: new Date(), suspensionReason: subStatus === 'canceled' ? 'Suscripción cancelada' : BILLING_SUSPENSION_REASON }
          : { suspendedAt: null, suspensionReason: null }),
      },
    });
    await this.audit.recordSystem(
      { action: 'organization.status_change', entityType: 'organization', entityId: organizationId, organizationId, before: { status: org.status }, after: { status: next, subscription: subStatus } },
      tx,
    );
  }

  /**
   * Barrido de billing-sync: reprocesa eventos pendientes, suspende las orgs
   * con pago vencido más allá de la gracia (P7) y aplica el fin de la prueba.
   */
  async sweep(now = new Date()): Promise<{ suspended: number; trialsEnded: number; reprocessed: number }> {
    const pending = await this.db.system.billingEvent.findMany({ where: { processedAt: null, attempts: { lt: 10 } }, take: 100 });
    let reprocessed = 0;
    for (const e of pending) {
      await this.processEvent(e.id).then(() => reprocessed++).catch((err) => this.logger.error(err.message));
    }

    const config = await this.db.system.trialConfig.findUniqueOrThrow({ where: { id: 1 } });
    const cutoff = new Date(now.getTime() - config.pastDueGraceDays * 86_400_000);
    const overdue = await this.db.system.subscription.findMany({
      where: { status: 'past_due', pastDueSince: { lte: cutoff }, organization: { status: 'past_due' } },
      select: { organizationId: true },
    });
    for (const { organizationId } of overdue) {
      await system('billing-sweep', () =>
        this.db.system.$transaction(async (tx) => {
          await tx.organization.update({
            where: { id: organizationId },
            data: { status: 'suspended', suspendedAt: now, suspensionReason: BILLING_SUSPENSION_REASON },
          });
          await this.audit.recordSystem(
            { action: 'organization.suspend_billing', entityType: 'organization', entityId: organizationId, organizationId, after: { graceDays: config.pastDueGraceDays } },
            tx,
          );
        }),
      );
    }

    const trials = await this.db.system.organization.findMany({ where: { status: 'trial', trialEndsAt: { lte: now } }, select: { id: true } });
    for (const { id } of trials) await this.endTrial(id, config);
    return { suspended: overdue.length, trialsEnded: trials.length, reprocessed };
  }

  /** Fin de la prueba según TrialConfig: pasar al plan configurado o pausar sorteos nuevos. */
  private async endTrial(organizationId: string, config: { onExpire: string; downgradePlanId: string | null }) {
    await system('billing-trial', () =>
      this.db.system.$transaction(async (tx) => {
        const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } });
        if (org.status !== 'trial') return;
        const current = await tx.subscription.findFirst({ where: { organizationId, status: { not: 'canceled' } } });
        if (current && current.status !== 'trialing') return;
        if (config.onExpire === 'downgrade_to_plan' && config.downgradePlanId) {
          if (current) await tx.subscription.update({ where: { id: current.id }, data: { status: 'canceled', canceledAt: new Date() } });
          await tx.subscription.create({
            data: { organizationId, planId: config.downgradePlanId, status: 'active', provider: 'manual', currentPeriodStart: new Date() },
          });
          await tx.organization.update({ where: { id: organizationId }, data: { status: 'active' } });
        } else {
          // «Pausar sorteos nuevos»: la cuenta sigue, pero no publica hasta elegir un plan.
          if (current) await tx.subscription.update({ where: { id: current.id }, data: { status: 'incomplete' } });
          await tx.organization.update({ where: { id: organizationId }, data: { status: 'past_due' } });
        }
        await this.audit.recordSystem(
          { action: 'organization.trial_end', entityType: 'organization', entityId: organizationId, organizationId, after: { onExpire: config.onExpire } },
          tx,
        );
      }),
    );
  }
}
