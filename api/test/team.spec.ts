import { as, closeTestApp, createOrg, createUser, createTestApp, TEST_PASSWORD, type TestContext } from './helpers';

describe('Equipo e invitaciones', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  const roleId = async (token: string, orgId: string, key: string) => {
    const roles = await ctx.http.get('/v1/roles').set(as(token, orgId)).expect(200);
    return roles.body.find((r: { key: string }) => r.key === key).id as string;
  };

  it('invitar → correo → aceptar con cuenta nueva → acceso con el rol', async () => {
    const t = await createOrg(ctx);
    const email = `karen-${Date.now()}@prueba.co`;
    const inv = await ctx.http
      .post('/v1/team/invitations')
      .set(as(t.ownerToken, t.org.id))
      .send({ email, name: 'Karen Díaz', roleId: await roleId(t.ownerToken, t.org.id, 'payment_verifier') })
      .expect(201);
    expect(inv.body.status).toBe('invited');

    const mail = ctx.mail.lastTo(email)!;
    expect(mail.subject).toContain(t.org.name);
    const token = /invitacion\/([\w-]+)/.exec(mail.text)![1];

    const preview = await ctx.http.get(`/v1/invitations/${token}`).expect(200);
    expect(preview.body).toMatchObject({ email, hasAccount: false, role: { key: 'payment_verifier' } });

    const accepted = await ctx.http.post(`/v1/invitations/${token}/accept`).send({ name: 'Karen Díaz', password: TEST_PASSWORD }).expect(200);
    expect(accepted.body.organizationId).toBe(t.org.id);

    const me = await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${accepted.body.accessToken}`).expect(200);
    expect(me.body.memberships[0].role.key).toBe('payment_verifier');
    // El token de invitación es de un solo uso.
    await ctx.http.post(`/v1/invitations/${token}/accept`).send({ password: TEST_PASSWORD }).expect(409);
  });

  it('una persona con cuenta confirma con su contraseña y puede estar en varias organizaciones', async () => {
    const t = await createOrg(ctx);
    const existing = await createUser(ctx, 'José Rodríguez');
    await ctx.http
      .post('/v1/team/invitations')
      .set(as(t.ownerToken, t.org.id))
      .send({ email: existing.email, name: 'José', roleId: await roleId(t.ownerToken, t.org.id, 'admin') })
      .expect(201);
    const token = /invitacion\/([\w-]+)/.exec(ctx.mail.lastTo(existing.email)!.text)![1];
    await ctx.http.post(`/v1/invitations/${token}/accept`).send({ password: 'equivocada-123' }).expect(401);
    await ctx.http.post(`/v1/invitations/${token}/accept`).send({ password: TEST_PASSWORD }).expect(200);

    const other = await createOrg(ctx);
    await ctx.http
      .post('/v1/team/invitations')
      .set(as(other.ownerToken, other.org.id))
      .send({ email: existing.email, name: 'José', roleId: await roleId(other.ownerToken, other.org.id, 'seller'), sellerCode: 'jose' })
      .expect(201);
    const token2 = /invitacion\/([\w-]+)/.exec(ctx.mail.lastTo(existing.email)!.text)![1];
    await ctx.http.post(`/v1/invitations/${token2}/accept`).send({ password: TEST_PASSWORD }).expect(200);

    const me = await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${ctx.tokens.signAccess({ typ: 'user', sub: existing.id })}`);
    expect(me.body.memberships).toHaveLength(2);
    expect(me.body.memberships.find((m: { sellerCode: string }) => m.sellerCode === 'JOSE')).toBeTruthy();
  });

  it('reenviar invalida el enlace anterior; códigos de vendedor únicos por org', async () => {
    const t = await createOrg(ctx);
    const seller = await roleId(t.ownerToken, t.org.id, 'seller');
    const email = `luis-${Date.now()}@prueba.co`;
    const inv = await ctx.http
      .post('/v1/team/invitations')
      .set(as(t.ownerToken, t.org.id))
      .send({ email, name: 'Luis Mora', roleId: seller, sellerCode: 'LUIS' })
      .expect(201);
    const first = /invitacion\/([\w-]+)/.exec(ctx.mail.lastTo(email)!.text)![1];
    await ctx.http.post(`/v1/team/members/${inv.body.id}/resend-invitation`).set(as(t.ownerToken, t.org.id)).expect(204);
    const second = /invitacion\/([\w-]+)/.exec(ctx.mail.lastTo(email)!.text)![1];
    expect(second).not.toBe(first);
    await ctx.http.get(`/v1/invitations/${first}`).expect(409);
    await ctx.http.get(`/v1/invitations/${second}`).expect(200);

    const dup = await ctx.http
      .post('/v1/team/invitations')
      .set(as(t.ownerToken, t.org.id))
      .send({ email: `otro-${Date.now()}@prueba.co`, name: 'Otro', roleId: seller, sellerCode: 'luis' })
      .expect(409);
    expect(dup.body.code).toBe('SELLER_CODE_TAKEN');
  });
});
