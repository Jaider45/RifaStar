import { authenticator } from 'otplib';
import { PasswordService } from '../src/auth/password.service';
import { as, closeTestApp, cookieValue, createOrg, createTestApp, TEST_PASSWORD, type TestContext, uid } from './helpers';

describe('Autenticación de plataforma (2FA obligatorio)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  async function platformUser(role: 'super_admin' | 'support' | 'finance' = 'super_admin') {
    return ctx.db.system.platformUser.create({
      data: {
        email: `p-${uid()}@rifastar.co`,
        name: 'Equipo Plataforma',
        role,
        passwordHash: await ctx.app.get(PasswordService).hash(TEST_PASSWORD),
      },
    });
  }

  it('la contraseña sola no da sesión: hay que enrolar y verificar TOTP', async () => {
    const user = await platformUser();
    const login = await ctx.http.post('/v1/platform/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
    expect(login.body).toMatchObject({ needsEnrollment: true });
    expect(login.body.accessToken).toBeUndefined();

    // El token de desafío no sirve como sesión.
    await ctx.http.get('/v1/platform/me').set('Authorization', `Bearer ${login.body.challengeToken}`).expect(401);

    const enroll = await ctx.http.post('/v1/platform/auth/2fa/enroll').send({ challengeToken: login.body.challengeToken }).expect(200);
    expect(enroll.body.otpauthUrl).toMatch(/^otpauth:\/\/totp\//);

    const bad = await ctx.http
      .post('/v1/platform/auth/2fa/verify')
      .send({ challengeToken: login.body.challengeToken, code: '123456' })
      .expect(401);
    expect(bad.body.code).toBe('AUTH_2FA_INVALID');

    const ok = await ctx.http
      .post('/v1/platform/auth/2fa/verify')
      .send({ challengeToken: login.body.challengeToken, code: authenticator.generate(enroll.body.secret) })
      .expect(200);
    expect(cookieValue(ok, 'rs_prt')).toBeTruthy();

    const me = await ctx.http.get('/v1/platform/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    expect(me.body).toMatchObject({ role: 'super_admin' });
    expect(me.body.permissions).toContain('platform.impersonate');

    // Segundo login: ya no pide enrolarse; el enroll queda bloqueado.
    const again = await ctx.http.post('/v1/platform/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
    expect(again.body.needsEnrollment).toBe(false);
    await ctx.http.post('/v1/platform/auth/2fa/enroll').send({ challengeToken: again.body.challengeToken }).expect(409);

    const audit = await ctx.db.system.auditLog.findFirst({ where: { action: 'platform.login', actorId: user.id } });
    expect(audit).toBeTruthy();
  });

  it('los tokens de plataforma y de organización no se mezclan', async () => {
    const { org, ownerToken } = await createOrg(ctx);
    const user = await platformUser('support');
    await ctx.db.system.platformUser.update({ where: { id: user.id }, data: { totpEnabledAt: new Date() } });
    const platformToken = ctx.tokens.signAccess({ typ: 'platform', sub: user.id, role: 'support' });

    await ctx.http.get('/v1/team').set(as(platformToken, org.id)).expect(403);
    await ctx.http.get('/v1/platform/me').set('Authorization', `Bearer ${ownerToken}`).expect(403);
  });

  it('el refresh de plataforma rota y detecta reutilización', async () => {
    const user = await platformUser('finance');
    const enrollLogin = await ctx.http.post('/v1/platform/auth/login').send({ email: user.email, password: TEST_PASSWORD });
    const enroll = await ctx.http.post('/v1/platform/auth/2fa/enroll').send({ challengeToken: enrollLogin.body.challengeToken });
    const ok = await ctx.http
      .post('/v1/platform/auth/2fa/verify')
      .send({ challengeToken: enrollLogin.body.challengeToken, code: authenticator.generate(enroll.body.secret) })
      .expect(200);
    const rt1 = cookieValue(ok, 'rs_prt')!;
    const r = await ctx.http.post('/v1/platform/auth/refresh').set('Cookie', `rs_prt=${rt1}`).expect(200);
    const rt2 = cookieValue(r, 'rs_prt')!;
    await ctx.http.post('/v1/platform/auth/refresh').set('Cookie', `rs_prt=${rt1}`).expect(401);
    await ctx.http.post('/v1/platform/auth/refresh').set('Cookie', `rs_prt=${rt2}`).expect(401);
  });
});
