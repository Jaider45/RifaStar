import { as, closeTestApp, createOrg, createTestApp, type TestContext } from './helpers';

describe('Ajustes por sección', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  it('valores por defecto, actualización con revisión y conflicto', async () => {
    const t = await createOrg(ctx);
    const all = await ctx.http.get('/v1/settings').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(all.body.payments).toEqual({ revision: 1, data: { reservationMinutes: 30, requireReceipt: true } });
    expect(all.body.ranking.data).toMatchObject({ frequency: 'monthly', tiebreaker: 'first_to_reach', nameFormat: 'first_name_initial' });

    const upd = await ctx.http
      .put('/v1/settings/payments')
      .set(as(t.ownerToken, t.org.id))
      .send({ revision: 1, data: { reservationMinutes: 60, requireReceipt: true } })
      .expect(200);
    expect(upd.body).toMatchObject({ revision: 2, data: { reservationMinutes: 60 } });

    const stale = await ctx.http
      .put('/v1/settings/payments')
      .set(as(t.ownerToken, t.org.id))
      .send({ revision: 1, data: { reservationMinutes: 120 } })
      .expect(409);
    expect(stale.body.code).toBe('REVISION_CONFLICT');

    const invalid = await ctx.http
      .put('/v1/settings/payments')
      .set(as(t.ownerToken, t.org.id))
      .send({ revision: 2, data: { reservationMinutes: 45 } })
      .expect(400);
    expect(invalid.body.code).toBe('VALIDATION_ERROR');
    expect(invalid.body.details[0].path).toEqual(['data', 'reservationMinutes']);

    await ctx.http.get('/v1/settings/inexistente').set(as(t.ownerToken, t.org.id)).expect(404);
  });
});
