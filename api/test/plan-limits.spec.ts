import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext } from './helpers';
import { createRaffle, nextPhone, reserve } from './fixtures';

describe('Límites del plan (PlanGuard, regla 8)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  it('Básico: 2 sorteos activos; el tercero responde 402 con código claro', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await createRaffle(ctx, t);
    await createRaffle(ctx, t);
    const third = await createRaffle(ctx, t, { publish: false });
    const res = await ctx.http.post(`/v1/raffles/${third.id}/publish`).set(as(t.ownerToken, t.org.id)).expect(402);
    expect(res.body).toEqual({
      code: 'PLAN_LIMIT_ACTIVE_RAFFLES',
      message: 'Tu plan Básico permite 2 sorteos activos. Termina uno o mejora tu plan.',
      details: { limit: 2, current: 2 },
    });
    // Los sorteos simultáneos tampoco pasan el límite.
    const other = await createOrg(ctx, { planCode: 'basico' });
    const drafts = await Promise.all([1, 2, 3].map(() => createRaffle(ctx, other, { publish: false })));
    const results = await Promise.all(drafts.map((d) => ctx.http.post(`/v1/raffles/${d.id}/publish`).set(as(other.ownerToken, other.org.id))));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 402]);
  });

  it('Básico: 1 miembro; invitar responde 402', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    const roles = await ctx.http.get('/v1/roles').set(as(t.ownerToken, t.org.id)).expect(200);
    const admin = roles.body.find((r: { key: string }) => r.key === 'admin').id;
    const res = await ctx.http.post('/v1/team/invitations').set(as(t.ownerToken, t.org.id)).send({ email: `x-${Date.now()}@prueba.co`, name: 'Otro', roleId: admin }).expect(402);
    expect(res.body.code).toBe('PLAN_LIMIT_MEMBERS');
    expect(res.body.message).toBe('Tu plan Básico permite 1 miembro en el equipo.');
  });

  it('funciones por plan: ranking, vendedores, roles personalizados, dominio y marca', async () => {
    const basico = await createOrg(ctx, { planCode: 'basico' });
    const pro = await createOrg(ctx, { planCode: 'pro' });
    const agencia = await createOrg(ctx, { planCode: 'agencia' });

    const ranking = await ctx.http.get('/v1/settings/ranking').set(as(basico.ownerToken, basico.org.id));
    const enable = await ctx.http
      .put('/v1/settings/ranking')
      .set(as(basico.ownerToken, basico.org.id))
      .send({ revision: ranking.body.revision, data: { ...ranking.body.data, enabled: true } })
      .expect(402);
    expect(enable.body.code).toBe('PLAN_FEATURE_RANKING');
    expect((await ctx.http.get('/v1/ranking/current').set(as(basico.ownerToken, basico.org.id)).expect(402)).body.code).toBe('PLAN_FEATURE_RANKING');

    const sellers = await ctx.http.get('/v1/sales/mine').set(as(basico.ownerToken, basico.org.id)).expect(402);
    expect(sellers.body.code).toBe('PLAN_FEATURE_SELLERS');

    const role = { name: 'Coordinador', permissions: ['raffles.view'] };
    expect((await ctx.http.post('/v1/roles').set(as(pro.ownerToken, pro.org.id)).send(role).expect(402)).body.code).toBe('PLAN_FEATURE_CUSTOM_ROLES');
    await ctx.http.post('/v1/roles').set(as(agencia.ownerToken, agencia.org.id)).send(role).expect(201);

    const domain = { domain: 'rifas.minegocio.com' };
    expect((await ctx.http.put('/v1/organization/custom-domain').set(as(pro.ownerToken, pro.org.id)).send(domain).expect(402)).body.code).toBe('PLAN_FEATURE_CUSTOM_DOMAIN');
    await ctx.http.put('/v1/organization/custom-domain').set(as(agencia.ownerToken, agencia.org.id)).send({ domain: `rifas-${Date.now()}.minegocio.com` }).expect(200);

    const branding = await ctx.http.get('/v1/settings/branding').set(as(pro.ownerToken, pro.org.id));
    const white = await ctx.http
      .put('/v1/settings/branding')
      .set(as(pro.ownerToken, pro.org.id))
      .send({ revision: branding.body.revision, data: { hideRifaStarBadge: true } })
      .expect(402);
    expect(white.body.code).toBe('PLAN_FEATURE_WHITE_LABEL');
  });

  it('sin la función de vendedores, el código del enlace no atribuye la venta', async () => {
    const t = await createOrg(ctx, { planCode: 'basico' });
    await addMember(ctx, t.org.id, 'admin', { sellerCode: 'ANA' });
    const raffle = await createRaffle(ctx, t);
    const res = await reserve(ctx, t, raffle.slug, { numbers: [1], sellerCode: 'ANA', phone: nextPhone() });
    const order = await ctx.db.system.order.findUniqueOrThrow({ where: { id: res.body.orderId } });
    expect(order.sellerMemberId).toBeNull();
  });

  it('el uso del plan se ve en /billing', async () => {
    const t = await createOrg(ctx, { planCode: 'pro' });
    await createRaffle(ctx, t);
    const res = await ctx.http.get('/v1/billing').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(res.body.plan).toMatchObject({ code: 'pro', name: 'Pro' });
    expect(res.body.usage).toMatchObject({
      activeRaffles: { used: 1, limit: 10 },
      members: { used: 1, limit: 5 },
      whatsappMessages: { used: 0, limit: 2000 },
    });
  });
});
