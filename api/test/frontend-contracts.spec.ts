import { addMember, as, bearer, closeTestApp, createOrg, createTestApp, platformUser, type TestContext, type TestOrg } from './helpers';
import { createRaffle } from './fixtures';

/** Endpoints que usa el frontend para pintar páginas sin depender de varias llamadas. */
describe('Contratos del frontend', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  it('página pública de la organización: sorteos visibles, próximo sorteo y zona horaria', async () => {
    const draft = await createRaffle(ctx, t, { publish: false });
    const live = await createRaffle(ctx, t);
    const res = await ctx.http.get(`/v1/public/orgs/${t.org.slug}`).expect(200);
    expect(res.headers['cache-control']).toContain('max-age=30');
    expect(res.body).toMatchObject({ slug: t.org.slug, timezone: 'America/Bogota', rafflesCompleted: 0, showRifaStarBadge: true });
    expect(res.body.nextRaffle).toMatchObject({ slug: live.slug, status: 'active', progress: { paid: 0, total: 100 } });
    const slugs = res.body.raffles.map((r: { slug: string }) => r.slug);
    expect(slugs).toContain(live.slug);
    expect(slugs).not.toContain(draft.slug);

    const raffle = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${live.slug}`).expect(200);
    expect(raffle.body.organization).toMatchObject({ timezone: 'America/Bogota', rafflesCompleted: 0 });

    await ctx.http.get('/v1/public/orgs/no-existe-esta-org').expect(404);
  });

  it('/organization describe a quien consulta (permisos y modo lectura)', async () => {
    const owner = await ctx.http.get('/v1/organization').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(owner.body.viewer).toMatchObject({ roleKey: 'owner', readOnly: false, supportSessionId: null });
    expect(owner.body.viewer.permissions).toContain('settings.billing');

    const seller = await addMember(ctx, t.org.id, 'seller', { sellerCode: 'VEN1' });
    const view = await ctx.http.get('/v1/organization').set(as(seller.token, t.org.id)).expect(200);
    expect(view.body.viewer.roleKey).toBe('seller');
    expect(view.body.viewer.permissions).not.toContain('settings.billing');
  });

  it('catálogo de planes para «Cambiar plan»', async () => {
    const res = await ctx.http.get('/v1/billing/plans').set(as(t.ownerToken, t.org.id)).expect(200);
    const pro = res.body.find((p: { code: string }) => p.code === 'pro');
    expect(pro).toMatchObject({ name: 'Pro', features: { ranking: true }, limits: { members: expect.any(Number) } });
    expect(typeof pro.purchasable).toBe('boolean');
  });

  it('catálogo de permisos para las matrices de roles de la plataforma', async () => {
    const admin = await platformUser(ctx);
    const res = await ctx.http.get('/v1/platform/permission-catalog').set(bearer(admin.token)).expect(200);
    expect(res.body.organization.map((p: { key: string }) => p.key)).toContain('raffles.view');
    expect(res.body.platform.map((p: { key: string }) => p.key)).toContain('platform.impersonate');
    const support = await platformUser(ctx, 'support');
    await ctx.http.get('/v1/platform/permission-catalog').set(bearer(support.token)).expect(403);
  });
});
