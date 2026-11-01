import { Injectable, Logger } from '@nestjs/common';
import { type BillingPaymentSource, type GatewayPayment, type GatewayPaymentStatus, Prisma, type Subscription } from '@prisma/client';
import { MailProvider } from '../auth/mail/mail.provider';
import { AppError, Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '../database/database.service';
import { PlanPolicyService } from '../plans/plan-policy.service';
import type { OrgContext } from '../tenancy/org-context';
import { GatewayAccountsService } from './gateway-accounts.service';
import { GatewayPaymentsService, presentPayment, type SettleResult } from './gateway-payments.service';
import type { ChangeCardDto, SubscribePlanDto } from './payments.dto';
import type { WompiCredentials, WompiTransaction } from './wompi/types';
import { WompiClient } from './wompi/wompi.client';

const DAY = 86_400_000;

/** Suma un mes respetando fin de mes (31 de enero + 1 mes = 28 o 29 de febrero, no 3 de marzo). */
export function addMonths(from: Date, months = 1): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';

const system = <T>(organizationId: string, requestId: string, fn: () => Promise<T>) =>
  requestContext.run({ requestId, organizationId, actor: { type: 'system', id: null, label: 'Cobro de planes (Wompi)' } }, fn);

/**
 * Planes de Rifa Star cobrados con Wompi y checkout propio. Wompi no tiene suscripciones: aquí se
 * guarda la tarjeta (fuente de pago), se cobra el primer mes al contratar y se vuelve a cobrar cada
 * mes. Si un cobro falla la cuenta pasa a «pago vencido», se reintenta cada 24 h durante la gracia
 * y, vencida la gracia, `billing-sync` la suspende (igual que con Stripe).
 */
@Injectable()
export class PlanBillingService {
  private readonly logger = new Logger(PlanBillingService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly accounts: GatewayAccountsService,
    private readonly wompi: WompiClient,
    private readonly payments: GatewayPaymentsService,
    private readonly billing: BillingService,
    private readonly plans: PlanPolicyService,
    private readonly audit: AuditService,
    private readonly mail: MailProvider,
  ) {
    this.payments.onSettled('subscription', (p, status, tx) => this.onSettled(p, status, tx));
  }

  /** Con Stripe como pasarela de planes estos endpoints no aplican. */
  private assertEnabled(): void {
    if (env().BILLING_DRIVER === 'stripe') {
      throw new AppError('BILLING_PROVIDER_MISMATCH', 409, 'Los planes se cobran con otra pasarela. Usa Ajustes › Plan.');
    }
  }

  // ---------------------------------------------------------------------------
  // Checkout propio (organizador)
  // ---------------------------------------------------------------------------

  /** Lo que el navegador necesita para tokenizar la tarjeta y mostrar los contratos de Wompi. */
  async checkoutConfig(planCode: string) {
    this.assertEnabled();
    const plan = await this.purchasablePlan(planCode);
    const creds = this.accounts.platformCredentials();
    const merchant = await this.wompi.merchant(creds.environment, creds.publicKey);
    return {
      environment: creds.environment,
      publicKey: creds.publicKey,
      tokenizeUrl: this.wompi.baseUrl(creds.environment),
      plan: { code: plan.code, name: plan.name },
      amountCop: plan.monthlyPriceCop,
      contracts: { terms: merchant.acceptance.permalink, personalData: merchant.personalData.permalink },
    };
  }

  private async purchasablePlan(planCode: string) {
    const plan = await this.db.system.plan.findUnique({ where: { code: planCode } });
    if (!plan || plan.archivedAt) throw Errors.validation({ field: 'planCode' }, 'Ese plan no existe.');
    if (plan.monthlyPriceCop <= 0) throw new AppError('PLAN_NOT_PURCHASABLE', 409, 'Este plan todavía no se puede comprar en línea. Escríbenos a soporte.');
    return plan;
  }

  /** Guarda la tarjeta en Wompi y devuelve su fuente de pago. La tarjeta se valida en este paso. */
  private async saveCard(organizationId: string, email: string, cardToken: string): Promise<{ source: BillingPaymentSource; creds: WompiCredentials }> {
    const creds = this.accounts.platformCredentials();
    const merchant = await this.wompi.merchant(creds.environment, creds.publicKey);
    const created = await this.wompi.createPaymentSource(creds, {
      token: cardToken,
      customerEmail: email,
      acceptanceToken: merchant.acceptance.token,
      acceptPersonalAuth: merchant.personalData.token,
    });
    if (created.status !== 'AVAILABLE') throw new AppError('CARD_NOT_ACCEPTED', 422, 'No pudimos guardar esa tarjeta. Prueba con otra.');
    const source = await this.db.system.billingPaymentSource.create({
      data: {
        organizationId,
        provider: 'wompi',
        externalId: created.id,
        brand: created.brand,
        lastFour: created.lastFour,
        expMonth: created.expMonth,
        expYear: created.expYear,
        customerEmail: email,
      },
    });
    return { source, creds };
  }

  /** Contrata o cambia de plan: guarda la tarjeta y cobra el primer mes. El resultado llega por consulta o webhook. */
  async subscribe(org: OrgContext, email: string, dto: SubscribePlanDto) {
    this.assertEnabled();
    const plan = await this.purchasablePlan(dto.planCode);
    const current = await this.plans.subscriptionOf(org.id);
    if (current?.provider === 'wompi' && current.status === 'active' && current.planId === plan.id) {
      throw Errors.conflict('ALREADY_SUBSCRIBED', 'Ya tienes este plan.');
    }
    const { source, creds } = await this.saveCard(org.id, email, dto.cardToken);
    let payment: GatewayPayment;
    try {
      payment = await this.db.system.gatewayPayment.create({
        data: {
          organizationId: org.id,
          environment: creds.environment,
          purpose: 'subscription',
          planId: plan.id,
          billingPaymentSourceId: source.id,
          method: 'CARD',
          amountCop: plan.monthlyPriceCop,
          customerEmail: email,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw Errors.conflict('PAYMENT_IN_PROGRESS', 'Ya hay un pago de tu plan en curso. Espera unos segundos.');
      throw err;
    }
    await this.audit.recordSystem({
      action: 'billing.subscribe_attempt',
      entityType: 'gateway_payment',
      entityId: payment.id,
      organizationId: org.id,
      after: { plan: plan.code, amountCop: plan.monthlyPriceCop, card: `${source.brand ?? ''} ••${source.lastFour ?? ''}` },
    });
    return { payment: presentPayment(await this.charge(payment, creds, source)) };
  }

  /** Cobra con la tarjeta guardada. No deja el pago «a medias»: si Wompi no responde, queda fallido. */
  private async charge(payment: GatewayPayment, creds: WompiCredentials, source: BillingPaymentSource): Promise<GatewayPayment> {
    try {
      const tx = await this.wompi.createTransaction(creds, {
        reference: payment.id,
        amountInCents: payment.amountCop * 100,
        customerEmail: payment.customerEmail,
        paymentSourceId: source.externalId,
      });
      const saved = await this.db.system.gatewayPayment.update({ where: { id: payment.id }, data: { externalId: tx.id, statusMessage: tx.statusMessage } });
      return tx.status === 'PENDING' ? saved : await this.payments.apply(saved.id, tx);
    } catch (err) {
      await this.payments.markFailed(payment.id, err instanceof AppError ? err.message : 'No se pudo cobrar.');
      throw err;
    }
  }

  /** Estado del último cobro del plan (consulta a Wompi mientras esté en curso). */
  async status(org: OrgContext) {
    let payment = await this.db.tenantTx(org.id, (tx) => tx.gatewayPayment.findFirst({ where: { purpose: 'subscription' }, orderBy: { createdAt: 'desc' } }));
    if (!payment) return { payment: null, subscription: null };
    if (payment.status === 'pending') payment = (await this.payments.refresh(payment.id)) ?? payment;
    const sub = await this.plans.subscriptionOf(org.id);
    return {
      payment: presentPayment(payment),
      subscription: sub && { plan: sub.plan.code, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
    };
  }

  /** Cambia la tarjeta de renovación. Si la cuenta estaba en «pago vencido», reintenta el cobro de inmediato. */
  async changeCard(org: OrgContext, email: string, dto: ChangeCardDto) {
    this.assertEnabled();
    const sub = await this.plans.subscriptionOf(org.id);
    if (!sub || sub.provider !== 'wompi') throw Errors.conflict('NO_BILLING_ACCOUNT', 'Aún no tienes un plan con tarjeta. Elige un plan primero.');
    const { source } = await this.saveCard(org.id, email, dto.cardToken);
    await this.db.system.$transaction(async (tx) => {
      if (sub.paymentSourceId) await tx.billingPaymentSource.update({ where: { id: sub.paymentSourceId }, data: { revokedAt: new Date() } });
      await tx.subscription.update({ where: { id: sub.id }, data: { paymentSourceId: source.id, lastChargeAttemptAt: null } });
    });
    await this.audit.recordSystem({ action: 'billing.card_change', entityType: 'subscription', entityId: sub.id, organizationId: org.id, after: { card: `${source.brand ?? ''} ••${source.lastFour ?? ''}` } });
    let retry: ReturnType<typeof presentPayment> | null = null;
    if (sub.status === 'past_due') retry = await this.renewOne(sub.id).then((p) => (p ? presentPayment(p) : null));
    return { card: { brand: source.brand, lastFour: source.lastFour, expMonth: source.expMonth, expYear: source.expYear }, retry };
  }

  /** Se cancela al final del periodo pagado: hasta entonces el plan sigue activo. */
  async setCancelAtPeriodEnd(org: OrgContext, cancel: boolean) {
    const sub = await this.plans.subscriptionOf(org.id);
    if (!sub || sub.provider !== 'wompi' || !['active', 'past_due'].includes(sub.status)) {
      throw Errors.conflict('NO_BILLING_ACCOUNT', 'No tienes un plan con tarjeta para cancelar.');
    }
    await this.db.system.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel } });
    await this.audit.recordSystem({
      action: cancel ? 'billing.cancel_scheduled' : 'billing.cancel_undone',
      entityType: 'subscription',
      entityId: sub.id,
      organizationId: org.id,
      after: { cancelAtPeriodEnd: cancel, currentPeriodEnd: sub.currentPeriodEnd },
    });
    return { cancelAtPeriodEnd: cancel, currentPeriodEnd: sub.currentPeriodEnd };
  }

  // ---------------------------------------------------------------------------
  // Resultado de un cobro
  // ---------------------------------------------------------------------------

  private async onSettled(p: GatewayPayment, status: GatewayPaymentStatus, tx: WompiTransaction): Promise<SettleResult> {
    return system(p.organizationId, `plan-${p.id}`, () => (status === 'approved' ? this.activate(p) : this.renewalFailed(p, status, tx)));
  }

  /** Cobro aprobado: crea la suscripción (o renueva la vigente), registra la factura y reactiva la cuenta. */
  private async activate(p: GatewayPayment): Promise<SettleResult> {
    const now = new Date();
    const subscriptionId = await this.db.system.$transaction(async (tx) => {
      const current = await tx.subscription.findFirst({ where: { organizationId: p.organizationId, status: { not: 'canceled' } }, orderBy: { createdAt: 'desc' } });
      const periodEnd = addMonths(now, 1);
      let sub: Subscription;
      if (current && p.subscriptionId === current.id) {
        // Renovación: nuevo periodo desde hoy y se limpian los reintentos.
        sub = await tx.subscription.update({
          where: { id: current.id },
          data: { status: 'active', currentPeriodStart: now, currentPeriodEnd: periodEnd, pastDueSince: null, chargeAttempts: 0, lastChargeAttemptAt: now },
        });
      } else {
        // Contratación o cambio de plan: reemplaza a la suscripción vigente (prueba, manual u otra).
        if (current) await tx.subscription.update({ where: { id: current.id }, data: { status: 'canceled', canceledAt: now } });
        sub = await tx.subscription.create({
          data: {
            organizationId: p.organizationId,
            planId: p.planId!,
            status: 'active',
            provider: 'wompi',
            paymentSourceId: p.billingPaymentSourceId,
            currentPeriodStart: now,
            currentPeriodEnd: periodEnd,
            lastChargeAttemptAt: now,
          },
        });
      }
      await tx.invoice.create({
        data: {
          organizationId: p.organizationId,
          subscriptionId: sub.id,
          provider: 'wompi',
          externalId: p.externalId ?? p.id,
          amountCop: p.amountCop,
          status: 'paid',
          attemptedAt: now,
          paidAt: now,
          periodStart: now,
          periodEnd,
        },
      });
      await this.billing.syncOrgStatus(tx, p.organizationId, 'active');
      await this.audit.recordSystem(
        { action: current && p.subscriptionId === current.id ? 'billing.renewed' : 'billing.subscribed', entityType: 'subscription', entityId: sub.id, organizationId: p.organizationId, after: { planId: p.planId, amountCop: p.amountCop, periodEnd } },
        tx,
      );
      return sub.id;
    });
    return { applied: true, subscriptionId };
  }

  /** Cobro fallido: si era una renovación, la cuenta pasa a «pago vencido» y se avisa al propietario. */
  private async renewalFailed(p: GatewayPayment, _status: GatewayPaymentStatus, tx: WompiTransaction): Promise<SettleResult> {
    if (!p.subscriptionId) return { applied: true }; // primer cobro rechazado: no hay nada que revertir
    const now = new Date();
    const reason = tx.statusMessage ?? 'El banco rechazó el cobro';
    const failed = await this.db.system.$transaction(async (db) => {
      const sub = await db.subscription.findUnique({ where: { id: p.subscriptionId! } });
      if (!sub || sub.status === 'canceled') return null;
      await db.subscription.update({
        where: { id: sub.id },
        data: { status: 'past_due', pastDueSince: sub.pastDueSince ?? now, chargeAttempts: { increment: 1 }, lastChargeAttemptAt: now },
      });
      await db.invoice.upsert({
        where: { provider_externalId: { provider: 'wompi', externalId: p.externalId ?? p.id } },
        create: { organizationId: p.organizationId, subscriptionId: sub.id, provider: 'wompi', externalId: p.externalId ?? p.id, amountCop: p.amountCop, status: 'failed', attemptedAt: now, failureReason: reason },
        update: { status: 'failed', attemptedAt: now, failureReason: reason },
      });
      await this.billing.syncOrgStatus(db, p.organizationId, 'past_due');
      return sub;
    });
    if (failed) await this.notifyFailure(p.organizationId, p.amountCop, reason);
    return { applied: true };
  }

  private async notifyFailure(organizationId: string, amountCop: number, reason: string): Promise<void> {
    try {
      const owners = await this.db.system.member.findMany({
        where: { organizationId, status: 'active', role: { key: { in: ['owner', 'admin'] } } },
        include: { user: { select: { email: true, name: true } } },
      });
      const grace = (await this.db.system.trialConfig.findUnique({ where: { id: 1 } }))?.pastDueGraceDays ?? 7;
      for (const m of owners) {
        await this.mail.send({
          to: m.user.email,
          subject: 'No pudimos cobrar tu plan de Rifa Star',
          text:
            `Hola, ${m.user.name}.\n\nNo pudimos cobrar $${amountCop.toLocaleString('es-CO')} COP de tu plan (${reason}). ` +
            `Vamos a reintentar cada día durante ${grace} días. Para evitar que tu cuenta se suspenda, ` +
            `actualiza tu tarjeta en ${env().PUBLIC_BASE_URL}/admin/ajustes?tab=plan.\n\nRifa Star`,
        });
      }
    } catch (err) {
      this.logger.error(`Aviso de cobro fallido (${organizationId}): ${(err as Error).message}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Renovaciones (job)
  // ---------------------------------------------------------------------------

  /**
   * Cobra las suscripciones cuyo periodo terminó, cancela las marcadas para cancelar y reintenta
   * (una vez al día) las que están en «pago vencido». Idempotente: un pago en curso evita el doble cobro
   * (índice único de pagos en curso por organización).
   */
  async renewDue(now = new Date()): Promise<{ charged: number; canceled: number }> {
    const due = await this.db.system.subscription.findMany({
      where: {
        provider: 'wompi',
        status: { in: ['active', 'past_due'] },
        currentPeriodEnd: { lte: now },
        organization: { status: { not: 'suspended' } },
      },
      take: 200,
    });
    let charged = 0;
    let canceled = 0;
    for (const sub of due) {
      try {
        if (sub.cancelAtPeriodEnd) {
          await this.cancelNow(sub);
          canceled++;
        } else if (sub.status === 'active' || !sub.lastChargeAttemptAt || now.getTime() - sub.lastChargeAttemptAt.getTime() >= DAY - 60_000) {
          // Activa y vencida: se cobra ya. El freno de una vez al día es solo para reintentar cobros fallidos.
          if (await this.renewOne(sub.id)) charged++;
        }
      } catch (err) {
        this.logger.error(`Renovación de ${sub.id}: ${(err as Error).message}`);
      }
    }
    return { charged, canceled };
  }

  private async cancelNow(sub: Subscription): Promise<void> {
    await system(sub.organizationId, `plan-cancel-${sub.id}`, () =>
      this.db.system.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { status: 'canceled', canceledAt: new Date() } });
        await this.billing.syncOrgStatus(tx, sub.organizationId, 'canceled');
        await this.audit.recordSystem({ action: 'billing.canceled', entityType: 'subscription', entityId: sub.id, organizationId: sub.organizationId }, tx);
      }),
    );
  }

  /** Un intento de cobro de la renovación. Devuelve el pago, o null si ya había uno en curso. */
  async renewOne(subscriptionId: string): Promise<GatewayPayment | null> {
    const sub = await this.db.system.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true, paymentSource: true } });
    if (!sub || !sub.paymentSource || sub.paymentSource.revokedAt) return null;
    const creds = this.accounts.platformCredentials();
    let payment: GatewayPayment;
    try {
      payment = await this.db.system.gatewayPayment.create({
        data: {
          organizationId: sub.organizationId,
          environment: creds.environment,
          purpose: 'subscription',
          subscriptionId: sub.id,
          planId: sub.planId,
          billingPaymentSourceId: sub.paymentSource.id,
          method: 'CARD',
          amountCop: sub.plan.monthlyPriceCop,
          customerEmail: sub.paymentSource.customerEmail,
        },
      });
    } catch (err) {
      if (isUniqueViolation(err)) return null; // ya hay un cobro en curso
      throw err;
    }
    await this.db.system.subscription.update({ where: { id: sub.id }, data: { lastChargeAttemptAt: new Date() } });
    try {
      return await this.charge(payment, creds, sub.paymentSource);
    } catch (err) {
      // Wompi caído: no es culpa del cliente. El cobro quedó fallido sin tocar la suscripción; se reintenta en la siguiente pasada.
      if (err instanceof AppError && err.code === 'GATEWAY_UNAVAILABLE') {
        await this.db.system.subscription.update({ where: { id: sub.id }, data: { lastChargeAttemptAt: null } });
        return null;
      }
      // La pasarela rechazó el cobro (tarjeta revocada, datos inválidos…): cuenta como cobro fallido,
      // para que empiece la gracia y la cuenta no quede «activa» sin pagar.
      const reason = err instanceof AppError ? err.message : 'No se pudo cobrar.';
      await system(sub.organizationId, `plan-${payment.id}`, () =>
        this.renewalFailed(payment, 'error', {
          id: '',
          reference: payment.id,
          status: 'ERROR',
          statusMessage: reason,
          amountInCents: payment.amountCop * 100,
          currency: 'COP',
          paymentMethodType: 'CARD',
          asyncPaymentUrl: null,
        }),
      );
      return this.db.system.gatewayPayment.findUnique({ where: { id: payment.id } });
    }
  }
}
