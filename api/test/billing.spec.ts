import Stripe from 'stripe';
import { BillingService } from '../src/billing/billing.service';
import { as, bearer, closeTestApp, createOrg, createTestApp, platformUser, type TestContext } from './helpers';
import { createRaffle } from './fixtures';

const stripe = new Stripe('sk_test_x');
const sign = (payload: string) => stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test_secret' });

describe('Suscripciones y billing-sync', () => {
  let ctx: TestContext;
  let billing: BillingService;
  beforeAll(async () => {
    ctx = await createTestApp();
    billing = ctx.app.get(BillingService);
    const admin = await platformUser(ctx);
    const pro = (await ctx.http.get('/v1/platform/plans').set(bearer(admin.token))).body.find((p: { code: string }) => p.code === 'pro');
    await ctx.http.patch(`/v1/platform/plans/${pro.id}`).set(bearer(admin.token)).send({ externalPriceIds: { stripe: 'price_pro_test' } }).expect(200);
  });
  afterAll(() => closeTestApp(ctx));

  let seq = 0;
  async function send(type: string, object: object) {
    const payload = JSON.stringify({ id: `evt_${Date.now()}_${++seq}`, object: 'event', type, data: { object } });
    const res = await ctx.http.post('/v1/webhooks/billing/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sign(payload)).send(payload);
    const event = await ctx.db.system.billingEvent.findFirst({ orderBy: { receivedAt: 'desc' } });
    if (res.body.duplicate === false) await billing.processEvent(event!.id);
    return { res, payload };
  }

  const subscription = (orgId: string, status: string) => ({
    id: `sub_${orgId.slice(0, 8)}`,
    object: 'subscription',
    customer: `cus_${orgId.slice(0, 8)}`,
    status,
    cancel_at_period_end: false,
    metadata: { organizationId: orgId },
    items: { data: [{ price: { id: 'price_pro_test' }, current_period_start: 1761955200, current_period_end: 1764547200 }] },
  });
  const invoice = (orgId: string, paid: boolean) => ({
    id: `in_${Date.now()}_${++seq}`,
    object: 'invoice',
    subscription: `sub_${orgId.slice(0, 8)}`,
    amount_due: 9_900_000,
    period_start: 1761955200,
    period_end: 1764547200,
    ...(paid ? {} : { last_finalization_error: { message: 'Fondos insuficientes' } }),
  });

  it('checkout con el precio del plan y webhook firmado e idempotente', async () => {
    const t = await createOrg(ctx);
    const checkout = await ctx.http.post('/v1/billing/checkout').set(as(t.ownerToken, t.org.id)).send({ planCode: 'pro' }).expect(200);
    expect(checkout.body.url).toContain('price=price_pro_test');
    expect((await ctx.http.post('/v1/billing/checkout').set(as(t.ownerToken, t.org.id)).send({ planCode: 'basico' }).expect(409)).body.code).toBe('PLAN_NOT_PURCHASABLE');

    const bad = await ctx.http.post('/v1/webhooks/billing/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', 't=1,v1=abc').send('{}').expect(401);
    expect(bad.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');

    const { payload } = await send('customer.subscription.created', subscription(t.org.id, 'active'));
    const sub = await ctx.db.system.subscription.findFirstOrThrow({ where: { organizationId: t.org.id, status: { not: 'canceled' } }, include: { plan: true } });
    expect(sub).toMatchObject({ provider: 'stripe', status: 'active', plan: { code: 'pro' } });
    expect(sub.currentPeriodEnd).toEqual(new Date(1764547200 * 1000));

    // El mismo evento otra vez no se procesa dos veces.
    const dup = await ctx.http.post('/v1/webhooks/billing/stripe').set('Content-Type', 'application/json').set('Stripe-Signature', sign(payload)).send(payload).expect(200);
    expect(dup.body.duplicate).toBe(true);

    const portal = await ctx.http.post('/v1/billing/portal').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(portal.body.url).toContain(`cus_${t.org.id.slice(0, 8)}`);
  });

  it('cobro fallido → past_due (todo sigue); tras la gracia → suspended; al pagar → active (P7)', async () => {
    const t = await createOrg(ctx);
    const raffle = await createRaffle(ctx, t);
    await send('customer.subscription.created', subscription(t.org.id, 'active'));
    await send('invoice.payment_failed', invoice(t.org.id, false));

    let org = await ctx.db.system.organization.findUniqueOrThrow({ where: { id: t.org.id } });
    expect(org.status).toBe('past_due');
    const res = await ctx.http.get('/v1/raffles').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(res.headers['x-account-status']).toBe('past_due');
    await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);

    // 6 días después sigue en gracia; a los 8, suspendida.
    await billing.sweep(new Date(Date.now() + 6 * 86_400_000));
    expect((await ctx.db.system.organization.findUniqueOrThrow({ where: { id: t.org.id } })).status).toBe('past_due');
    await billing.sweep(new Date(Date.now() + 8 * 86_400_000));
    org = await ctx.db.system.organization.findUniqueOrThrow({ where: { id: t.org.id } });
    expect(org).toMatchObject({ status: 'suspended', suspensionReason: 'Pago vencido' });
    await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(403);
    // Puede seguir pagando su plan aunque esté suspendida.
    await ctx.http.post('/v1/billing/checkout').set(as(t.ownerToken, t.org.id)).send({ planCode: 'pro' }).expect(200);

    await send('invoice.paid', invoice(t.org.id, true));
    org = await ctx.db.system.organization.findUniqueOrThrow({ where: { id: t.org.id } });
    expect(org.status).toBe('active');

    const failed = await ctx.http.get('/v1/platform/billing/failed-payments').set(bearer((await platformUser(ctx, 'finance')).token)).expect(200);
    expect(failed.body.find((f: { organization: { id: string } }) => f.organization.id === t.org.id)).toMatchObject({ amountCop: 99_000, failureReason: 'Fondos insuficientes' });
  });

  it('una suspensión manual no se levanta sola al pagar', async () => {
    const t = await createOrg(ctx);
    await send('customer.subscription.created', subscription(t.org.id, 'active'));
    await ctx.db.system.organization.update({ where: { id: t.org.id }, data: { status: 'suspended', suspensionReason: 'Fraude' } });
    await send('invoice.paid', invoice(t.org.id, true));
    expect((await ctx.db.system.organization.findUniqueOrThrow({ where: { id: t.org.id } })).status).toBe('suspended');
  });

  it('fin de la prueba: pasa al plan configurado (Básico) o pausa sorteos nuevos', async () => {
    // Registro autoservicio = prueba con el plan Pro.
    const signup = await ctx.http
      .post('/v1/auth/signup')
      .send({ name: 'Felipe Arango', email: `felipe-${Date.now()}@prueba.co`, password: 'clave-segura-123', organization: { name: 'Moto Ya', slug: `motoya-${Date.now()}` } })
      .expect(201);
    const orgId = signup.body.organizationId;
    await ctx.db.system.organization.update({ where: { id: orgId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    await billing.sweep();
    const sub = await ctx.db.system.subscription.findFirstOrThrow({ where: { organizationId: orgId, status: { not: 'canceled' } }, include: { plan: true } });
    expect(sub.plan.code).toBe('basico');
    expect((await ctx.db.system.organization.findUniqueOrThrow({ where: { id: orgId } })).status).toBe('active');

    // Con «Pausar sorteos nuevos»: no publica hasta elegir plan.
    await ctx.db.system.trialConfig.update({ where: { id: 1 }, data: { onExpire: 'block_new_raffles' } });
    try {
      const t = await ctx.http
        .post('/v1/auth/signup')
        .send({ name: 'Kelly Barrios', email: `kelly-${Date.now()}@prueba.co`, password: 'clave-segura-123', organization: { name: 'Rifas Costa', slug: `costa-${Date.now()}` } })
        .expect(201);
      await ctx.db.system.organization.update({ where: { id: t.body.organizationId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
      await billing.sweep();
      const owner = { ownerToken: t.body.accessToken, org: { id: t.body.organizationId } };
      const raffle = await createRaffle(ctx, owner as never, { publish: false });
      const res = await ctx.http.post(`/v1/raffles/${raffle.id}/publish`).set(as(t.body.accessToken, t.body.organizationId)).expect(402);
      expect(res.body.code).toBe('PLAN_TRIAL_EXPIRED');
    } finally {
      await ctx.db.system.trialConfig.update({ where: { id: 1 }, data: { onExpire: 'downgrade_to_plan' } });
    }
  });
});
