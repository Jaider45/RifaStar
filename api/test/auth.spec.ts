import { authenticator } from 'otplib';
import { closeTestApp, cookieValue, createTestApp, createUser, TEST_PASSWORD, type TestContext, uid } from './helpers';

describe('Autenticación de usuarios de organización', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  it('registro autoservicio crea owner y organización en prueba', async () => {
    const slug = `mi-org-${uid()}`;
    const email = `owner-${uid()}@prueba.co`;
    const res = await ctx.http
      .post('/v1/auth/signup')
      .send({ name: 'Michellys Tovar', email, password: TEST_PASSWORD, organization: { name: 'Mis Rifas', slug } })
      .expect(201);
    expect(res.body.accessToken).toBeTruthy();
    expect(cookieValue(res, 'rs_rt')).toBeTruthy();
    expect(JSON.stringify(res.body)).not.toContain(cookieValue(res, 'rs_rt'));

    const me = await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
    expect(me.body.memberships).toHaveLength(1);
    expect(me.body.memberships[0].organization).toMatchObject({ slug, status: 'trial' });
    expect(me.body.memberships[0].role.key).toBe('owner');
    expect(me.body.memberships[0].permissions).toHaveLength(16); // todas las del catálogo

    const sub = await ctx.db.system.subscription.findFirstOrThrow({ where: { organizationId: res.body.organizationId } });
    expect(sub.status).toBe('trialing');
    expect(sub.trialEndsAt).toBeTruthy();
  });

  it('rechaza slugs repetidos o reservados con mensajes en español', async () => {
    const slug = `dup-${uid()}`;
    await ctx.http
      .post('/v1/auth/signup')
      .send({ name: 'Uno', email: `a-${uid()}@prueba.co`, password: TEST_PASSWORD, organization: { name: 'Uno', slug } })
      .expect(201);
    const dup = await ctx.http
      .post('/v1/auth/signup')
      .send({ name: 'Dos', email: `b-${uid()}@prueba.co`, password: TEST_PASSWORD, organization: { name: 'Dos', slug } })
      .expect(409);
    expect(dup.body).toMatchObject({ code: 'SLUG_TAKEN' });
    expect(dup.body.message).toMatch(/ya está en uso/);

    const reserved = await ctx.http
      .post('/v1/auth/signup')
      .send({ name: 'Tres', email: `c-${uid()}@prueba.co`, password: TEST_PASSWORD, organization: { name: 'Tres', slug: 'admin' } })
      .expect(400);
    expect(reserved.body.code).toBe('VALIDATION_ERROR');
    expect(reserved.body.details[0].message).toBe('Esa dirección está reservada.');
  });

  it('login con credenciales incorrectas responde 401 sin revelar cuál falló', async () => {
    const user = await createUser(ctx, undefined, { twoFactor: false });
    const res = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: 'otra-cosa-123' }).expect(401);
    expect(res.body).toEqual({ code: 'AUTH_INVALID_CREDENTIALS', message: 'El correo o la contraseña no son correctos.' });
    const unknown = await ctx.http.post('/v1/auth/login').send({ email: `x-${uid()}@prueba.co`, password: 'otra-cosa-123' }).expect(401);
    expect(unknown.body.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('el refresh token rota y su reutilización revoca toda la familia', async () => {
    const user = await createUser(ctx, undefined, { twoFactor: false });
    const login = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
    const rt1 = cookieValue(login, 'rs_rt')!;

    const r1 = await ctx.http.post('/v1/auth/refresh').set('Cookie', `rs_rt=${rt1}`).expect(200);
    const rt2 = cookieValue(r1, 'rs_rt')!;
    expect(rt2).toBeTruthy();
    expect(rt2).not.toBe(rt1);

    // Reutilizar el token viejo = posible robo → se revoca la familia.
    await ctx.http.post('/v1/auth/refresh').set('Cookie', `rs_rt=${rt1}`).expect(401);
    await ctx.http.post('/v1/auth/refresh').set('Cookie', `rs_rt=${rt2}`).expect(401);
  });

  it('logout revoca el refresh token', async () => {
    const user = await createUser(ctx, undefined, { twoFactor: false });
    const login = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
    const rt = cookieValue(login, 'rs_rt')!;
    await ctx.http.post('/v1/auth/logout').set('Cookie', `rs_rt=${rt}`).expect(204);
    await ctx.http.post('/v1/auth/refresh').set('Cookie', `rs_rt=${rt}`).expect(401);
  });

  it('2FA opcional: una vez activo, el login exige el código', async () => {
    const user = await createUser(ctx, undefined, { twoFactor: false });
    const token = ctx.tokens.signAccess({ typ: 'user', sub: user.id });
    const setup = await ctx.http.post('/v1/auth/2fa/setup').set('Authorization', `Bearer ${token}`).expect(201);
    await ctx.http
      .post('/v1/auth/2fa/enable')
      .set('Authorization', `Bearer ${token}`)
      .send({ code: authenticator.generate(setup.body.secret) })
      .expect(204);

    const noCode = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(401);
    expect(noCode.body.code).toBe('AUTH_2FA_REQUIRED');
    await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD, totpCode: '000000' }).expect(401);
    // El mismo código que activó la verificación no sirve otra vez (un solo uso).
    const usado = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD, totpCode: authenticator.generate(setup.body.secret) }).expect(401);
    expect(usado.body.code).toBe('AUTH_2FA_INVALID');
    await ctx.db.system.user.update({ where: { id: user.id }, data: { totpLastStep: null } });
    await ctx.http
      .post('/v1/auth/login')
      .send({ email: user.email, password: TEST_PASSWORD, totpCode: authenticator.generate(setup.body.secret) })
      .expect(200);
  });

  it('recuperación de contraseña por correo', async () => {
    const user = await createUser(ctx, undefined, { twoFactor: false });
    await ctx.http.post('/v1/auth/password/forgot').send({ email: user.email }).expect(202);
    // Correo inexistente: misma respuesta.
    await ctx.http.post('/v1/auth/password/forgot').send({ email: `nadie-${uid()}@prueba.co` }).expect(202);

    const mail = ctx.mail.lastTo(user.email)!;
    const token = /restablecer\/([\w-]+)/.exec(mail.text)![1];
    await ctx.http.post('/v1/auth/password/reset').send({ token, password: 'nueva-clave-456' }).expect(204);
    await ctx.http.post('/v1/auth/password/reset').send({ token, password: 'otra-clave-789' }).expect(409);
    await ctx.http.post('/v1/auth/login').send({ email: user.email, password: 'nueva-clave-456' }).expect(200);
  });

  it('las rutas protegidas exigen sesión', async () => {
    const res = await ctx.http.get('/v1/auth/me').expect(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
    await ctx.http.get('/v1/auth/me').set('Authorization', 'Bearer basura').expect(401);
  });
});
