import { as, bearer, closeTestApp, createOrg, createTestApp, platformUser, type TestContext, type TestOrg } from './helpers';
import { createRaffle } from './fixtures';

describe('Entrar como soporte (regla 9)', () => {
  let ctx: TestContext;
  let t: TestOrg;
  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
    await createRaffle(ctx, t);
  });
  afterAll(() => closeTestApp(ctx));

  it('solo super_admin y support; finanzas no puede', async () => {
    const finance = await platformUser(ctx, 'finance');
    const res = await ctx.http.post(`/v1/platform/orgs/${t.org.id}/support-sessions`).set(bearer(finance.token)).send({ reason: 'Revisar pagos' }).expect(403);
    expect(res.body.details.missing).toEqual(['platform.impersonate']);
  });

  it('modo lectura, por tiempo limitado, auditado y con aviso al organizador', async () => {
    const agent = await platformUser(ctx, 'support');
    const start = await ctx.http
      .post(`/v1/platform/orgs/${t.org.id}/support-sessions`)
      .set(bearer(agent.token))
      .send({ reason: 'El organizador no ve sus pagos', minutes: 15 })
      .expect(201);
    expect(start.body.readOnly).toBe(true);
    const minutes = (new Date(start.body.expiresAt).getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(14);
    expect(minutes).toBeLessThanOrEqual(15);
    const support = bearer(start.body.accessToken);

    // Puede leer (sin X-Organization-Id: la org va en el token).
    const raffles = await ctx.http.get('/v1/raffles').set(support).expect(200);
    expect(raffles.body).toHaveLength(1);
    expect(raffles.headers['x-support-session']).toContain(`id=${start.body.sessionId}`);
    await ctx.http.get('/v1/participants').set(support).expect(200);

    // No puede escribir.
    const write = await ctx.http.patch('/v1/organization').set(support).send({ name: 'Cambio' }).expect(403);
    expect(write.body).toMatchObject({ code: 'SUPPORT_READ_ONLY', message: 'Estás en modo soporte: solo puedes consultar, no hacer cambios.' });
    await ctx.http.post(`/v1/raffles/${raffles.body[0].id}/close-sales`).set(support).expect(403);

    // No sirve para otra organización.
    const other = await createOrg(ctx);
    await ctx.http.get('/v1/raffles').set(support).set('X-Organization-Id', other.org.id).expect(403);

    // El organizador ve el aviso mientras dure la sesión.
    const owner = await ctx.http.get('/v1/organization').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(owner.headers['x-support-active']).toMatch(/^expires=/);

    const audit = await ctx.db.system.auditLog.findMany({ where: { supportSessionId: start.body.sessionId }, orderBy: { id: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['support.request']));
    expect(await ctx.db.system.auditLog.count({ where: { action: 'support.session_start', entityId: start.body.sessionId } })).toBe(1);

    // Al terminar, el token deja de servir y desaparece el aviso.
    await ctx.http.delete(`/v1/platform/support-sessions/${start.body.sessionId}`).set(bearer(agent.token)).expect(204);
    await ctx.http.get('/v1/raffles').set(support).expect(401);
    const after = await ctx.http.get('/v1/organization').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(after.headers['x-support-active']).toBeUndefined();
  });

  it('la sesión vence sola', async () => {
    const agent = await platformUser(ctx, 'super_admin');
    const start = await ctx.http.post(`/v1/platform/orgs/${t.org.id}/support-sessions`).set(bearer(agent.token)).send({ reason: 'Prueba', minutes: 5 }).expect(201);
    await ctx.db.system.supportSession.update({ where: { id: start.body.sessionId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await ctx.http.get('/v1/raffles').set(bearer(start.body.accessToken)).expect(401);
  });
});
