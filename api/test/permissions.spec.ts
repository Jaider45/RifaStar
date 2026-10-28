import { BASE_ROLE_TEMPLATE, ORG_PERMISSION_KEYS } from '../src/permissions/catalog';
import { PermissionsService } from '../src/permissions/permissions.service';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';

describe('Permisos por rol', () => {
  let ctx: TestContext;
  let base: TestOrg;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    ctx = await createTestApp();
    base = await createOrg(ctx);
    tokens.owner = base.ownerToken;
    for (const role of ['admin', 'payment_verifier', 'seller']) {
      tokens[role] = (await addMember(ctx, base.org.id, role)).token;
    }
  });
  afterAll(() => closeTestApp(ctx));

  it('cada rol base resuelve exactamente las claves de la plantilla (§5)', async () => {
    const svc = ctx.app.get(PermissionsService);
    for (const roleKey of Object.keys(BASE_ROLE_TEMPLATE)) {
      const { user } = await addMember(ctx, base.org.id, roleKey);
      const resolved = await svc.resolveMembership(base.org.id, user.id);
      expect([...resolved!.permissions].sort()).toEqual([...BASE_ROLE_TEMPLATE[roleKey as keyof typeof BASE_ROLE_TEMPLATE].permissions].sort());
    }
    expect(BASE_ROLE_TEMPLATE.owner.permissions).toHaveLength(ORG_PERMISSION_KEYS.length);
    expect(BASE_ROLE_TEMPLATE.admin.permissions).not.toEqual(
      expect.arrayContaining(['raffles.delete', 'participants.export', 'settings.team', 'settings.billing']),
    );
    expect(BASE_ROLE_TEMPLATE.payment_verifier.permissions.sort()).toEqual(
      ['participants.view_contact', 'payments.approve', 'payments.view', 'raffles.view', 'receipts.issue'],
    );
    expect(BASE_ROLE_TEMPLATE.seller.permissions.sort()).toEqual(['raffles.view', 'sales.view_own']);
  });

  // [ruta, método, cuerpo, roles que pasan]
  const matrix: [string, 'get' | 'patch' | 'put', object | undefined, string[]][] = [
    ['/v1/team', 'get', undefined, ['owner']],
    ['/v1/roles', 'get', undefined, ['owner']],
    ['/v1/organization', 'patch', { defaultAccentColor: '#ab1f24' }, ['owner', 'admin']],
    ['/v1/settings/payments', 'put', { revision: -1, data: {} }, ['owner', 'admin']],
    ['/v1/settings/ranking', 'put', { revision: -1, data: {} }, ['owner', 'admin']],
    ['/v1/organization', 'get', undefined, ['owner', 'admin', 'payment_verifier', 'seller']],
  ];

  for (const [path, method, body, allowed] of matrix) {
    for (const role of ['owner', 'admin', 'payment_verifier', 'seller']) {
      const pass = allowed.includes(role);
      it(`${method.toUpperCase()} ${path} · ${role} → ${pass ? 'permitido' : '403'}`, async () => {
        let req = ctx.http[method](path).set(as(tokens[role], base.org.id));
        if (body) req = req.send(body);
        const res = await req;
        if (pass) {
          expect(res.status).not.toBe(403);
        } else {
          expect(res.status).toBe(403);
          expect(res.body.code).toBe('FORBIDDEN_PERMISSION');
          expect(res.body.message).toBe('No tienes permiso para hacer esto.');
        }
      });
    }
  }

  it('un rol personalizado solo tiene las claves que se le asignan', async () => {
    const created = await ctx.http
      .post('/v1/roles')
      .set(as(tokens.owner, base.org.id))
      .send({ name: 'Coordinador', permissions: ['settings.team', 'raffles.view'] })
      .expect(201);
    expect(created.body).toMatchObject({ key: 'coordinador', custom: true });

    const { token } = await addMember(ctx, base.org.id, 'coordinador');
    await ctx.http.get('/v1/team').set(as(token, base.org.id)).expect(200);
    await ctx.http.patch('/v1/organization').set(as(token, base.org.id)).send({ name: 'Nuevo nombre' }).expect(403);

    // Los roles base no se editan desde la org.
    const roles = await ctx.http.get('/v1/roles').set(as(tokens.owner, base.org.id)).expect(200);
    const adminRole = roles.body.find((r: { key: string }) => r.key === 'admin');
    const res = await ctx.http.patch(`/v1/roles/${adminRole.id}`).set(as(tokens.owner, base.org.id)).send({ name: 'Rol X' }).expect(409);
    expect(res.body.code).toBe('ROLE_IS_TEMPLATE');
  });

  it('no se puede quitar ni degradar al último owner', async () => {
    const t = await createOrg(ctx);
    const team = await ctx.http.get('/v1/team').set(as(t.ownerToken, t.org.id)).expect(200);
    const ownerMember = team.body[0];
    const roles = await ctx.http.get('/v1/roles').set(as(t.ownerToken, t.org.id)).expect(200);
    const roleId = (key: string) => roles.body.find((r: { key: string }) => r.key === key).id;

    const del = await ctx.http.delete(`/v1/team/members/${ownerMember.id}`).set(as(t.ownerToken, t.org.id)).expect(409);
    expect(del.body).toMatchObject({ code: 'LAST_OWNER', message: 'La organización debe tener al menos un propietario.' });
    await ctx.http
      .patch(`/v1/team/members/${ownerMember.id}`)
      .set(as(t.ownerToken, t.org.id))
      .send({ roleId: roleId('admin') })
      .expect(409);

    // Con un segundo owner sí se puede.
    const second = await addMember(ctx, t.org.id, 'owner');
    await ctx.http
      .patch(`/v1/team/members/${ownerMember.id}`)
      .set(as(second.token, t.org.id))
      .send({ roleId: roleId('admin') })
      .expect(200);
    const last = await ctx.http.delete(`/v1/team/members/${second.member.id}`).set(as(second.token, t.org.id)).expect(409);
    expect(last.body.code).toBe('LAST_OWNER');
  });

  it('solo un owner puede nombrar owners', async () => {
    const t = await createOrg(ctx);
    const roles = await ctx.http.get('/v1/roles').set(as(t.ownerToken, t.org.id)).expect(200);
    const ownerRoleId = roles.body.find((r: { key: string }) => r.key === 'owner').id;
    await ctx.http
      .post('/v1/roles')
      .set(as(t.ownerToken, t.org.id))
      .send({ name: 'Jefe de equipo', permissions: ['settings.team'] })
      .expect(201);
    const lead = await addMember(ctx, t.org.id, 'jefe-de-equipo');
    const target = await addMember(ctx, t.org.id, 'seller');
    await ctx.http
      .patch(`/v1/team/members/${target.member.id}`)
      .set(as(lead.token, t.org.id))
      .send({ roleId: ownerRoleId })
      .expect(403);
  });

  it('un miembro removido pierde el acceso de inmediato', async () => {
    const t = await createOrg(ctx);
    const admin = await addMember(ctx, t.org.id, 'admin');
    await ctx.http.get('/v1/organization').set(as(admin.token, t.org.id)).expect(200);
    await ctx.http.delete(`/v1/team/members/${admin.member.id}`).set(as(t.ownerToken, t.org.id)).expect(204);
    await ctx.http.get('/v1/organization').set(as(admin.token, t.org.id)).expect(403);
  });
});
