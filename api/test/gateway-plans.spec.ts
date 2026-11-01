import { BillingService } from '../src/billing/billing.service';
import { resetEnvCache } from '../src/config/env';
import { GatewayPaymentsService } from '../src/payments/gateway-payments.service';
import { addMonths, PlanBillingService } from '../src/payments/plan-billing.service';
import { eventChecksum } from '../src/payments/wompi/signatures';
import { FakeWompiClient, WompiClient } from '../src/payments/wompi/wompi.client';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';
import { createRaffle, reserve } from './fixtures';

/** Secreto de eventos de la cuenta de Rifa Star con el Wompi simulado. */
const PLATFORM_EVENTS_SECRET = 'test_events_simulada';

function signedEvent(tx: { id: string; reference: string; status: string; amount_in_cents: number }, secret: string) {
  const event = {
    event: 'transaction.updated',
    data: { transaction: tx },
    environment: 'test',
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp: Math.floor(Date.now() / 1000),
    sent_at: new Date().toISOString(),
  };
  event.signature.checksum = eventChecksum(event, secret);
  return event;
}

const accept = { acceptTerms: true, acceptPersonalData: true };
const DAY = 86_400_000;

describe('addMonths', () => {
  it('respeta el fin de mes', () => {
    expect(addMonths(new Date('2026-01-31T10:00:00Z')).toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addMonths(new Date('2028-01-31T10:00:00Z')).toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addMonths(new Date('2026-12-31T10:00:00Z')).toISOString()).toBe('2027-01-31T10:00:00.000Z');
    expect(addMonths(new Date('2026-10-15T10:00:00Z')).toISOString()).toBe('2026-11-15T10:00:00.000Z');
  });
});

describe('Planes con Wompi (checkout propio, cobro mensual)', () => {
  let ctx: TestContext;
  let wompi: FakeWompiClient;
  let gateway: GatewayPaymentsService;
  let planBilling: PlanBillingService;
  let billing: BillingService;

  beforeAll(async () => {
    ctx = await createTestApp();
    wompi = ctx.app.get(WompiClient) as FakeWompiClient;
    gateway = ctx.app.get(GatewayPaymentsService);
    planBilling = ctx.app.get(PlanBillingService);
    billing = ctx.app.get(BillingService);
  });
  afterAll(() => closeTestApp(ctx));

  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const subscribe = (t: TestOrg, body: object, token = t.ownerToken) =>
    ctx.http.post('/v1/billing/subscribe').set(as(token, t.org.id)).set('X-Forwarded-For', ip()).send(body);
  const lastPayment = (t: TestOrg) => ctx.db.system.gatewayPayment.findFirstOrThrow({ where: { organizationId: t.org.id, purpose: 'subscription' }, orderBy: { createdAt: 'desc' } });
  const sub = (t: TestOrg) => ctx.db.system.subscription.findFirstOrThrow({ where: { organizationId: t.org.id, status: { not: 'canceled' } } });
  const orgRow = (t: TestOrg) => ctx.db.system.organization.findUniqueOrThrow({ where: { id: t.org.id } });
  /** Confirma con Wompi el último cobro del plan (lo que hacen la consulta del navegador y el webhook). */
  const settle = async (t: TestOrg) => gateway.refresh((await lastPayment(t)).id);

  it('entrega la configuración para tokenizar la tarjeta y valida el plan', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    const res = await ctx.http.get('/v1/billing/card-checkout?planCode=pro').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(res.body).toMatchObject({ environment: 'sandbox', amountCop: 99_000, plan: { code: 'pro', name: 'Pro' } });
    expect(res.body.publicKey).toMatch(/^pub_test_/);
    expect(res.body.contracts.terms).toMatch(/^https:\/\//);
    expect(JSON.stringify(res.body)).not.toMatch(/prv_|integrity|events_/);

    await ctx.http.get('/v1/billing/card-checkout?planCode=no-existe').set(as(t.ownerToken, t.org.id)).expect(400);
    const seller = await addMember(ctx, t.org.id, 'seller', { sellerCode: 'VEN1' });
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }, seller.token).expect(403);
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', acceptTerms: false, acceptPersonalData: true }).expect(400);
    await ctx.http.post('/v1/billing/subscribe').send({ planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(401);
  });

  it('tarjeta rechazada: no se crea la suscripción y el plan actual sigue igual', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    const before = await sub(t);
    const res = await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_1111', ...accept }).expect(200);
    expect(res.body.payment).toMatchObject({ status: 'pending', method: 'CARD', amountCop: 99_000 });
    await settle(t);
    const st = await ctx.http.get('/v1/billing/subscribe/status').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(st.body.payment).toMatchObject({ status: 'declined', final: true });
    expect((await sub(t)).id).toBe(before.id);
    expect(await ctx.db.system.subscription.count({ where: { organizationId: t.org.id, provider: 'wompi' } })).toBe(0);
  });

  it('tarjeta aprobada: crea la suscripción por un mes, la factura y la tarjeta que se muestra', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    const res = await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    expect(res.body.payment.status).toBe('pending');
    const sent = wompi.transactions.get((await lastPayment(t)).externalId!)!.body;
    // Cobro con la tarjeta guardada (no con el token) y referencia = id del pago.
    expect(sent).toMatchObject({ amount_in_cents: 9_900_000, currency: 'COP', reference: (await lastPayment(t)).id });
    expect(sent.payment_source_id).toBeDefined();
    expect(JSON.stringify(sent)).not.toContain('tok_test_4242');

    const st = await ctx.http.get('/v1/billing/subscribe/status').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(st.body.payment).toMatchObject({ status: 'approved' });
    expect(st.body.subscription).toMatchObject({ plan: 'pro', status: 'active' });

    const s = await sub(t);
    expect(s).toMatchObject({ provider: 'wompi', status: 'active', chargeAttempts: 0 });
    const days = (s.currentPeriodEnd!.getTime() - s.currentPeriodStart!.getTime()) / DAY;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
    expect(await ctx.db.system.subscription.count({ where: { organizationId: t.org.id, status: { not: 'canceled' } } })).toBe(1);
    expect(await ctx.db.system.invoice.findFirstOrThrow({ where: { subscriptionId: s.id } })).toMatchObject({ status: 'paid', amountCop: 99_000, provider: 'wompi' });
    expect((await orgRow(t)).status).toBe('active');
    expect((await lastPayment(t)).subscriptionId).toBe(s.id);

    const overview = await ctx.http.get('/v1/billing').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(overview.body).toMatchObject({ checkoutMode: 'embedded', plan: { code: 'pro' } });
    expect(overview.body.subscription.card).toMatchObject({ brand: 'VISA', lastFour: '4242' });
    expect(JSON.stringify(overview.body)).not.toContain('tok_test');

    // Mismo plan otra vez: no se cobra dos veces.
    expect((await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept })).body.code).toBe('ALREADY_SUBSCRIBED');
  });

  it('renovación: cobra al terminar el periodo, una sola vez, y extiende un mes', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    await settle(t);
    const first = await sub(t);

    // Aún no vence: no se cobra.
    expect(await planBilling.renewDue()).toEqual({ charged: 0, canceled: 0 });

    await ctx.db.system.subscription.update({ where: { id: first.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    expect(await planBilling.renewDue()).toEqual({ charged: 1, canceled: 0 });
    expect(await planBilling.renewDue()).toEqual({ charged: 0, canceled: 0 }); // el mismo día no se repite
    expect(await ctx.db.system.gatewayPayment.count({ where: { subscriptionId: first.id, status: 'pending' } })).toBe(1);

    await settle(t);
    const renewed = await sub(t);
    expect(renewed.id).toBe(first.id);
    expect(renewed.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now() + 27 * DAY);
    expect(renewed.status).toBe('active');
    expect(await ctx.db.system.invoice.count({ where: { subscriptionId: first.id, status: 'paid' } })).toBe(2);
    expect(await planBilling.renewDue()).toEqual({ charged: 0, canceled: 0 });
  });

  it('renovación rechazada: «pago vencido», aviso por correo, reintento diario y suspensión tras la gracia; cambiar la tarjeta reactiva', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    await settle(t);
    const s0 = await sub(t);
    wompi.failSource((await ctx.db.system.billingPaymentSource.findFirstOrThrow({ where: { organizationId: t.org.id } })).externalId);

    await ctx.db.system.subscription.update({ where: { id: s0.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await planBilling.renewDue();
    await settle(t);
    expect(await sub(t)).toMatchObject({ status: 'past_due', chargeAttempts: 1 });
    expect((await sub(t)).pastDueSince).not.toBeNull();
    expect((await orgRow(t)).status).toBe('past_due');
    expect(await ctx.db.system.invoice.count({ where: { subscriptionId: s0.id, status: 'failed' } })).toBe(1);
    const mail = ctx.mail.lastTo(t.owner.email);
    expect(mail?.subject).toBe('No pudimos cobrar tu plan de Rifa Star');
    expect(mail?.text).toContain('/admin/ajustes?tab=plan');

    // El mismo día no se reintenta; al día siguiente sí.
    expect(await planBilling.renewDue()).toEqual({ charged: 0, canceled: 0 });
    await ctx.db.system.subscription.update({ where: { id: s0.id }, data: { lastChargeAttemptAt: new Date(Date.now() - 25 * 3_600_000) } });
    expect(await planBilling.renewDue()).toEqual({ charged: 1, canceled: 0 });
    await settle(t);
    expect((await sub(t)).chargeAttempts).toBe(2);

    // Vencida la gracia (7 días), billing-sync suspende la cuenta.
    await ctx.db.system.subscription.update({ where: { id: s0.id }, data: { pastDueSince: new Date(Date.now() - 8 * DAY) } });
    await billing.sweep();
    expect(await orgRow(t)).toMatchObject({ status: 'suspended', suspensionReason: 'Pago vencido' });
    expect(await planBilling.renewDue()).toEqual({ charged: 0, canceled: 0 }); // suspendida: ya no se reintenta sola

    // Con la cuenta suspendida aún puede cambiar la tarjeta; el cobro se reintenta al instante.
    const changed = await ctx.http.post('/v1/billing/card').set(as(t.ownerToken, t.org.id)).send({ cardToken: 'tok_test_4242', ...accept }).expect(200);
    expect(changed.body.card).toMatchObject({ lastFour: '4242' });
    expect(changed.body.retry).toMatchObject({ status: 'pending', amountCop: 99_000 });
    await settle(t);
    expect(await sub(t)).toMatchObject({ status: 'active', chargeAttempts: 0, pastDueSince: null });
    expect((await orgRow(t)).status).toBe('active');
    expect(await ctx.db.system.billingPaymentSource.count({ where: { organizationId: t.org.id, revokedAt: null } })).toBe(1);
  });

  it('cancelar: sigue activo hasta el fin del periodo, se puede deshacer y al final se suspende; volver a pagar reactiva', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    await settle(t);
    const s0 = await sub(t);

    const cancel = await ctx.http.post('/v1/billing/cancel').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(cancel.body.cancelAtPeriodEnd).toBe(true);
    expect((await orgRow(t)).status).toBe('active');
    await ctx.http.post('/v1/billing/resume').set(as(t.ownerToken, t.org.id)).expect(200);
    expect((await sub(t)).cancelAtPeriodEnd).toBe(false);
    await ctx.http.post('/v1/billing/cancel').set(as(t.ownerToken, t.org.id)).expect(200);

    await ctx.db.system.subscription.update({ where: { id: s0.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    expect(await planBilling.renewDue()).toEqual({ charged: 0, canceled: 1 });
    expect(await ctx.db.system.gatewayPayment.count({ where: { subscriptionId: s0.id } })).toBe(1); // no se cobró de nuevo
    expect(await orgRow(t)).toMatchObject({ status: 'suspended', suspensionReason: 'Suscripción cancelada' });

    // Suspendida por cancelar, puede contratar de nuevo y la cuenta vuelve.
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    await settle(t);
    expect((await orgRow(t)).status).toBe('active');
    expect(await sub(t)).toMatchObject({ status: 'active', provider: 'wompi', cancelAtPeriodEnd: false });
  });

  it('una suspensión manual de la plataforma NO se levanta al pagar', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await ctx.db.system.organization.update({ where: { id: t.org.id }, data: { status: 'suspended', suspensionReason: 'Uso indebido', suspendedAt: new Date() } });
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    await settle(t);
    expect(await orgRow(t)).toMatchObject({ status: 'suspended', suspensionReason: 'Uso indebido' });
  });

  it('webhook de la plataforma: firma válida aprueba el cobro del plan; firma inválida → 401', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await subscribe(t, { planCode: 'pro', cardToken: 'tok_test_4242', ...accept }).expect(200);
    const p = await lastPayment(t);
    wompi.settle(p.externalId!, 'APPROVED');
    const tx = { id: p.externalId!, reference: p.id, status: 'APPROVED', amount_in_cents: 9_900_000 };

    await ctx.http.post('/v1/webhooks/wompi/platform').send(signedEvent(tx, 'test_events_OtroSecreto123')).expect(401);
    expect((await sub(t)).provider).not.toBe('wompi');

    const ok = await ctx.http.post('/v1/webhooks/wompi/platform').send(signedEvent(tx, PLATFORM_EVENTS_SECRET)).expect(200);
    expect(ok.body).toMatchObject({ received: true, duplicate: false });
    expect(await sub(t)).toMatchObject({ provider: 'wompi', status: 'active' });
  });

  it('el webhook de la plataforma no puede aprobar el pago de una boleta de una organización', async () => {
    const t = await createOrg(ctx);
    const raffle = await createRaffle(ctx, t);
    const keys = { publicKey: 'pub_test_AbC123xyz456', privateKey: 'prv_test_Secret1234567890', integritySecret: 'test_integrity_Abc1234567', eventsSecret: 'test_events_Abc1234567' };
    await ctx.http.put('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send(keys).expect(200);
    const order = (await reserve(ctx, t, raffle.slug, { numbers: [5] })).body;
    await ctx.http
      .post(`/v1/public/orders/${order.orderId}/pay`)
      .set('X-Order-Token', order.accessToken)
      .set('X-Forwarded-For', ip())
      .send({ method: 'NEQUI', phone: '3991111111', email: 'a@b.co', ...accept })
      .expect(200);
    const row = await ctx.db.system.gatewayPayment.findFirstOrThrow({ where: { orderId: order.orderId } });
    wompi.settle(row.externalId!, 'APPROVED');

    const evt = signedEvent({ id: row.externalId!, reference: row.id, status: 'APPROVED', amount_in_cents: 600_000 }, PLATFORM_EVENTS_SECRET);
    await ctx.http.post('/v1/webhooks/wompi/platform').send(evt).expect(200);
    expect((await ctx.db.system.order.findUniqueOrThrow({ where: { id: order.orderId } })).status).toBe('reserved');
    expect((await ctx.db.system.gatewayPayment.findUniqueOrThrow({ where: { id: row.id } })).status).toBe('pending');
  });

  it('con Stripe como pasarela de planes los endpoints de Wompi no aplican', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    process.env.BILLING_DRIVER = 'stripe';
    resetEnvCache();
    try {
      const res = await ctx.http.get('/v1/billing/card-checkout?planCode=pro').set(as(t.ownerToken, t.org.id));
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('BILLING_PROVIDER_MISMATCH');
      const overview = await ctx.http.get('/v1/billing').set(as(t.ownerToken, t.org.id)).expect(200);
      expect(overview.body.checkoutMode).toBe('redirect');
    } finally {
      process.env.BILLING_DRIVER = 'fake';
      resetEnvCache();
    }
  });
});
