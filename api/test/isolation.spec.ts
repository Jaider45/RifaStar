import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';

describe('Aislamiento entre organizaciones', () => {
  let ctx: TestContext;
  let a: TestOrg;
  let b: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    a = await createOrg(ctx);
    b = await createOrg(ctx);
    await addMember(ctx, b.org.id, 'admin');
    await ctx.http.post('/v1/roles').set(as(b.ownerToken, b.org.id)).send({ name: 'Secreto de B', permissions: ['raffles.view'] }).expect(201);
  });
  afterAll(() => closeTestApp(ctx));

  describe('API', () => {
    it('un usuario de A no puede operar en B cambiando la cabecera', async () => {
      for (const [method, path] of [
        ['get', '/v1/team'],
        ['get', '/v1/organization'],
        ['get', '/v1/settings'],
        ['get', '/v1/roles'],
      ] as const) {
        const res = await ctx.http[method](path).set(as(a.ownerToken, b.org.id));
        expect(res.status).toBe(403);
        expect(res.body.code).toBe('FORBIDDEN_PERMISSION');
      }
      await ctx.http.patch('/v1/organization').set(as(a.ownerToken, b.org.id)).send({ name: 'Hackeada' }).expect(403);
      const orgB = await ctx.db.system.organization.findUniqueOrThrow({ where: { id: b.org.id } });
      expect(orgB.name).not.toBe('Hackeada');
    });

    it('la lista de equipo y roles de A no incluye nada de B', async () => {
      const team = await ctx.http.get('/v1/team').set(as(a.ownerToken, a.org.id)).expect(200);
      expect(team.body).toHaveLength(1);
      const roles = await ctx.http.get('/v1/roles').set(as(a.ownerToken, a.org.id)).expect(200);
      expect(roles.body.map((r: { name: string }) => r.name)).not.toContain('Secreto de B');
    });

    it('no se puede tocar un miembro de B con un id válido desde A', async () => {
      const memberOfB = await ctx.db.system.member.findFirstOrThrow({ where: { organizationId: b.org.id } });
      await ctx.http.delete(`/v1/team/members/${memberOfB.id}`).set(as(a.ownerToken, a.org.id)).expect(404);
      const still = await ctx.db.system.member.findUniqueOrThrow({ where: { id: memberOfB.id } });
      expect(still.status).toBe('active');
    });
  });

  describe('RLS en Postgres (segunda barrera)', () => {
    it('con app.org_id = A solo se ven filas de A, aunque la consulta no filtre', async () => {
      await ctx.db.tenantTx(a.org.id, async (tx) => {
        const members = await tx.member.findMany();
        expect(members.every((m) => m.organizationId === a.org.id)).toBe(true);
        const orgs = await tx.organization.findMany();
        expect(orgs.map((o) => o.id)).toEqual([a.org.id]);
        const settings = await tx.orgSettings.findMany();
        expect(settings.every((s) => s.organizationId === a.org.id)).toBe(true);
        const roles = await tx.role.findMany();
        expect(roles.every((r) => r.organizationId === null || r.organizationId === a.org.id)).toBe(true);
        const users = await tx.user.findMany();
        expect(users.map((u) => u.id)).toEqual([a.owner.id]);
      });
    });

    it('sin organización activa la app no ve datos de ningún tenant', async () => {
      expect(await ctx.db.app.member.count()).toBe(0);
      expect(await ctx.db.app.organization.count()).toBe(0);
      expect(await ctx.db.app.orgSettings.count()).toBe(0);
    });

    it('no se pueden escribir filas de otra organización', async () => {
      const ownerRole = await ctx.db.system.role.findFirstOrThrow({ where: { key: 'admin', organizationId: null } });
      await expect(
        ctx.db.tenantTx(a.org.id, (tx) =>
          tx.member.create({ data: { organizationId: b.org.id, userId: a.owner.id, roleId: ownerRole.id, status: 'active' } }),
        ),
      ).rejects.toThrow(/row-level security/);

      const updated = await ctx.db.tenantTx(a.org.id, (tx) =>
        tx.organization.updateMany({ where: { id: b.org.id }, data: { name: 'Cambio cruzado' } }),
      );
      expect(updated.count).toBe(0);
    });

    it('la plantilla de roles es de solo lectura para la app', async () => {
      const deleted = await ctx.db.tenantTx(a.org.id, (tx) => tx.role.deleteMany({ where: { organizationId: null } }));
      expect(deleted.count).toBe(0);
      await expect(
        ctx.db.tenantTx(a.org.id, (tx) => tx.role.create({ data: { key: 'falso', name: 'Falso', organizationId: null } })),
      ).rejects.toThrow(/row-level security/);
    });

    it('el rol de la app no puede leer tablas de plataforma', async () => {
      await expect(ctx.db.app.platformUser.findMany()).rejects.toThrow(/permission denied/);
      await expect(ctx.db.app.refreshToken.findMany()).rejects.toThrow(/permission denied/);
    });

    it('el registro de auditoría es inmutable', async () => {
      await ctx.http.patch('/v1/organization').set(as(a.ownerToken, a.org.id)).send({ name: 'Rifas A' }).expect(200);
      const row = await ctx.db.system.auditLog.findFirstOrThrow({ where: { organizationId: a.org.id, action: 'organization.update' } });
      expect(row.before).toMatchObject({ name: a.org.name });
      expect(row.after).toMatchObject({ name: 'Rifas A' });
      expect(row.actorId).toBe(a.owner.id);
      await expect(ctx.db.system.auditLog.update({ where: { id: row.id }, data: { action: 'x' } })).rejects.toThrow(/inmutable/);
      await expect(ctx.db.system.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(/inmutable/);
    });
  });
});
