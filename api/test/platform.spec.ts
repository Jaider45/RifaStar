import { addMember, as, bearer, closeTestApp, createOrg, createTestApp, platformUser, type TestContext } from './helpers';
import { createRaffle, reserveAndSubmit } from './fixtures';

describe('Plataforma', () => {
  let ctx: TestContext;
  let admin: { token: string; user: { id: string } };
  beforeAll(async () => {
    ctx = await createTestApp();
    admin = await platformUser(ctx, 'super_admin');
  });
  afterAll(() => closeTestApp(ctx));

  it('los usuarios de organización no entran a /platform y los de plataforma requieren 2FA', async () => {
    const t = await createOrg(ctx);
    await ctx.http.get('/v1/platform/orgs').set(bearer(t.ownerToken)).expect(403);
    const noTotp = await ctx.db.system.platformUser.create({ data: { email: `n-${Date.now()}@rifastar.co`, name: 'Sin 2FA', role: 'super_admin', passwordHash: 'x' } });
    await ctx.http.get('/v1/platform/orgs').set(bearer(ctx.tokens.signAccess({ typ: 'platform', sub: noTotp.id, role: 'super_admin' }))).expect(401);
  });

  it('crear organización con owner invitado, listar con filtros, suspender y reactivar', async () => {
    const slug = `plat-${Date.now()}`;
    const created = await ctx.http
      .post('/v1/platform/orgs')
      .set(bearer(admin.token))
      .send({ name: 'Sorteos El Paisa', slug, ownerEmail: `hernan-${Date.now()}@prueba.co`, ownerName: 'Hernán Zapata', planCode: 'pro' })
      .expect(201);
    expect(created.body).toMatchObject({ slug, status: 'active', subscriptions: [{ plan: 'pro', status: 'active' }] });
    expect(created.body.members[0]).toMatchObject({ role: 'owner', status: 'invited' });

    const list = await ctx.http.get(`/v1/platform/orgs?q=${slug}`).set(bearer(admin.token)).expect(200);
    expect(list.body.items[0]).toMatchObject({ slug, plan: { code: 'pro' }, owner: { name: 'Hernán Zapata' } });

    const t = await createOrg(ctx);
    const raffle = await createRaffle(ctx, t);
    await ctx.http.post(`/v1/platform/orgs/${t.org.id}/suspend`).set(bearer(admin.token)).send({ reason: 'Fraude reportado' }).expect(200);
    const suspendedList = await ctx.http.get('/v1/platform/orgs?status=suspended').set(bearer(admin.token)).expect(200);
    expect(suspendedList.body.items.map((o: { id: string }) => o.id)).toContain(t.org.id);

    // Suspendida: el panel queda en solo lectura y el enlace público no vende.
    await ctx.http.get('/v1/raffles').set(as(t.ownerToken, t.org.id)).expect(200);
    const blocked = await ctx.http.post('/v1/raffles').set(as(t.ownerToken, t.org.id)).send({}).expect(403);
    expect(blocked.body.code).toBe('ORG_SUSPENDED');
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(403);
    expect(pub.body.message).toBe('Este sorteo no está disponible en este momento.');

    await ctx.http.post(`/v1/platform/orgs/${t.org.id}/reactivate`).set(bearer(admin.token)).expect(200);
    await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);

    const audit = await ctx.http.get(`/v1/platform/audit-logs?organizationId=${t.org.id}&action=platform.org_`).set(bearer(admin.token)).expect(200);
    expect(audit.body.items.map((a: { action: string }) => a.action)).toEqual(['platform.org_reactivate', 'platform.org_suspend']);
    expect(audit.body.items[0].actorId).toBe(admin.user.id);
  });

  it('la plantilla de roles aplica a todas las organizaciones (P10); el owner no se toca', async () => {
    const t = await createOrg(ctx);
    const adm = await addMember(ctx, t.org.id, 'admin');
    const raffle = await createRaffle(ctx, t);
    const o = await reserveAndSubmit(ctx, t, raffle.slug, [1]);

    const templates = await ctx.http.get('/v1/platform/role-templates').set(bearer(admin.token)).expect(200);
    const adminTpl = templates.body.find((r: { key: string }) => r.key === 'admin');
    const without = adminTpl.permissions.filter((p: string) => p !== 'payments.release');
    await ctx.http.put('/v1/platform/role-templates/admin/permissions').set(bearer(admin.token)).send({ permissions: without }).expect(200);
    await ctx.http.post(`/v1/orders/${o.orderId}/release`).set(as(adm.token, t.org.id)).send({ reason: 'x y z' }).expect(403);
    // Se restaura para no afectar otros tests.
    await ctx.http.put('/v1/platform/role-templates/admin/permissions').set(bearer(admin.token)).send({ permissions: adminTpl.permissions }).expect(200);
    await ctx.http.post(`/v1/orders/${o.orderId}/release`).set(as(adm.token, t.org.id)).send({ reason: 'x y z' }).expect(200);

    const owner = await ctx.http.put('/v1/platform/role-templates/owner/permissions').set(bearer(admin.token)).send({ permissions: [] }).expect(409);
    expect(owner.body.code).toBe('ROLE_LOCKED');
  });

  it('planes, prueba gratis, equipo de plataforma y estadísticas', async () => {
    const plan = await ctx.http
      .post('/v1/platform/plans')
      .set(bearer(admin.token))
      .send({
        code: `temporada-${Date.now()}`, name: 'Temporada', monthlyPriceCop: 59_000, maxActiveRaffles: 3, maxMembers: 2, monthlyWhatsappMessages: 500,
        featureRanking: true, featureWhatsappAuto: false, featureSellers: false, featureCustomRoles: false, featureCustomDomain: false, featureWhiteLabel: false,
      })
      .expect(201);
    await ctx.http.patch(`/v1/platform/plans/${plan.body.id}`).set(bearer(admin.token)).send({ monthlyPriceCop: 69_000 }).expect(200);
    await ctx.http.delete(`/v1/platform/plans/${plan.body.id}`).set(bearer(admin.token)).expect(204);
    const pro = (await ctx.http.get('/v1/platform/plans').set(bearer(admin.token)).expect(200)).body.find((p: { code: string }) => p.code === 'pro');
    expect(pro.subscribers).toBeGreaterThanOrEqual(0);
    expect((await ctx.http.delete(`/v1/platform/plans/${pro.id}`).set(bearer(admin.token))).status).toBe(409);

    const trial = await ctx.http.get('/v1/platform/trial-config').set(bearer(admin.token)).expect(200);
    expect(trial.body).toMatchObject({ planCode: 'pro', days: 14, onExpire: 'downgrade_to_plan', downgradePlanCode: 'basico', pastDueGraceDays: 7 });

    const support = await platformUser(ctx, 'support');
    await ctx.http.get('/v1/platform/plans').set(bearer(support.token)).expect(200);
    await ctx.http.put('/v1/platform/trial-config').set(bearer(support.token)).send(trial.body).expect(403);

    const member = await ctx.http.post('/v1/platform/team').set(bearer(admin.token)).send({ email: `fin-${Date.now()}@rifastar.co`, name: 'Finanzas', role: 'finance' }).expect(201);
    expect(ctx.mail.lastTo(member.body.email)?.text).toMatch(/contraseña temporal/);

    const solo = await ctx.db.system.platformUser.findMany({ where: { role: 'super_admin', disabledAt: null } });
    for (const u of solo.filter((u) => u.id !== admin.user.id)) await ctx.db.system.platformUser.update({ where: { id: u.id }, data: { disabledAt: new Date() } });
    const last = await ctx.http.patch(`/v1/platform/team/${admin.user.id}`).set(bearer(admin.token)).send({ role: 'support' }).expect(409);
    expect(last.body.code).toBe('LAST_SUPER_ADMIN');

    const stats = await ctx.http.get('/v1/platform/stats').set(bearer(admin.token)).expect(200);
    expect(stats.body.organizations.total).toBeGreaterThan(0);
    expect(stats.body).toHaveProperty('mrrCop');
    const supportStats = await ctx.http.get('/v1/platform/stats').set(bearer(support.token)).expect(200);
    expect(supportStats.body).not.toHaveProperty('mrrCop');
  });
});
