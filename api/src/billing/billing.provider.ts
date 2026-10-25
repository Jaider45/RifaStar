import { Injectable } from '@nestjs/common';
import type { SubscriptionStatus } from '@prisma/client';
import Stripe from 'stripe';
import { env } from '../config/env';

/** Evento de facturación normalizado (independiente del proveedor). */
export type BillingWebhookEvent =
  | {
      kind: 'subscription';
      id: string;
      type: string;
      organizationId: string | null;
      externalSubscriptionId: string;
      externalCustomerId: string | null;
      status: SubscriptionStatus;
      priceId: string | null;
      periodStart: Date | null;
      periodEnd: Date | null;
      cancelAtPeriodEnd: boolean;
    }
  | {
      kind: 'invoice';
      id: string;
      type: string;
      paid: boolean;
      externalInvoiceId: string;
      externalSubscriptionId: string | null;
      amountCop: number;
      failureReason: string | null;
      periodStart: Date | null;
      periodEnd: Date | null;
    }
  | { kind: 'ignored'; id: string; type: string };

export interface CheckoutRequest {
  organizationId: string;
  priceId: string;
  customerEmail: string;
  customerId?: string | null;
  successUrl: string;
  cancelUrl: string;
}

/**
 * Pasarela de suscripciones intercambiable. Stripe es la primera
 * implementación; Wompi o Mercado Pago implementan esta misma interfaz.
 */
export abstract class BillingProvider {
  abstract readonly kind: 'stripe' | 'wompi' | 'mercadopago';
  abstract createCheckout(req: CheckoutRequest): Promise<{ url: string }>;
  abstract createPortal(customerId: string, returnUrl: string): Promise<{ url: string }>;
  /** Verifica la firma y normaliza. Lanza si la firma no es válida. */
  abstract parseWebhook(rawBody: Buffer, signature: string | undefined): BillingWebhookEvent;
}

const STRIPE_STATUS: Record<string, SubscriptionStatus> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  unpaid: 'past_due',
  canceled: 'canceled',
  incomplete: 'incomplete',
  incomplete_expired: 'canceled',
  paused: 'past_due',
};

const toDate = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);

@Injectable()
export class StripeBillingProvider extends BillingProvider {
  readonly kind = 'stripe' as const;
  protected readonly stripe = new Stripe(env().STRIPE_SECRET_KEY || 'sk_test_sin_configurar');

  async createCheckout(req: CheckoutRequest): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: req.priceId, quantity: 1 }],
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      client_reference_id: req.organizationId,
      ...(req.customerId ? { customer: req.customerId } : { customer_email: req.customerEmail }),
      subscription_data: { metadata: { organizationId: req.organizationId } },
      metadata: { organizationId: req.organizationId },
    });
    return { url: session.url! };
  }

  async createPortal(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({ customer: customerId, return_url: returnUrl });
    return { url: session.url };
  }

  parseWebhook(rawBody: Buffer, signature: string | undefined): BillingWebhookEvent {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature ?? '', env().STRIPE_WEBHOOK_SECRET);
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const item = sub.items?.data?.[0] as (Stripe.SubscriptionItem & { current_period_start?: number; current_period_end?: number }) | undefined;
        const legacy = sub as unknown as { current_period_start?: number; current_period_end?: number };
        return {
          kind: 'subscription',
          id: event.id,
          type: event.type,
          organizationId: (sub.metadata?.organizationId as string | undefined) ?? null,
          externalSubscriptionId: sub.id,
          externalCustomerId: typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null),
          status: event.type === 'customer.subscription.deleted' ? 'canceled' : (STRIPE_STATUS[sub.status] ?? 'incomplete'),
          priceId: item?.price?.id ?? null,
          periodStart: toDate(item?.current_period_start ?? legacy.current_period_start),
          periodEnd: toDate(item?.current_period_end ?? legacy.current_period_end),
          cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
        };
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const inv = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } | null; last_finalization_error?: { message?: string } | null };
        const subRef = inv.subscription ?? (inv as unknown as { parent?: { subscription_details?: { subscription?: string } } }).parent?.subscription_details?.subscription ?? null;
        return {
          kind: 'invoice',
          id: event.id,
          type: event.type,
          paid: event.type === 'invoice.paid',
          externalInvoiceId: inv.id!,
          externalSubscriptionId: typeof subRef === 'string' ? subRef : (subRef?.id ?? null),
          // COP en Stripe usa 2 decimales: se guarda en pesos enteros.
          amountCop: Math.round((inv.amount_due ?? 0) / 100),
          failureReason: event.type === 'invoice.payment_failed' ? (inv.last_finalization_error?.message ?? 'El cobro fue rechazado') : null,
          periodStart: toDate(inv.period_start),
          periodEnd: toDate(inv.period_end),
        };
      }
      default:
        return { kind: 'ignored', id: event.id, type: event.type };
    }
  }
}

/** Desarrollo y tests: sin llamadas a Stripe, pero con la misma verificación de firma. */
@Injectable()
export class FakeBillingProvider extends StripeBillingProvider {
  override async createCheckout(req: CheckoutRequest): Promise<{ url: string }> {
    return { url: `https://pagos.local/checkout?org=${req.organizationId}&price=${req.priceId}` };
  }

  override async createPortal(customerId: string): Promise<{ url: string }> {
    return { url: `https://pagos.local/portal?customer=${customerId}` };
  }
}
