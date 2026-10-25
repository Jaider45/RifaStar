import { MaintenanceService } from '../src/jobs/maintenance.service';
import type { OrderEvent } from '../src/orders/order-hooks';
import { RankingService } from '../src/ranking/ranking.service';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';
import { createRaffle, nextPhone, reserve, reserveAndSubmit } from './fixtures';

describe('Ranking', () => {
  let ctx: TestContext;
  let ranking: RankingService;

  beforeAll(async () => {
    ctx = await createTestApp();
    ranking = ctx.app.get(RankingService);
  });
  afterAll(() => closeTestApp(ctx));

  async function enableRanking(t: TestOrg, overrides: object = {}) {
    const current = await ctx.http.get('/v1/settings/ranking').set(as(t.ownerToken, t.org.id)).expect(200);
    await ctx.http
      .put('/v1/settings/ranking')
      .set(as(t.ownerToken, t.org.id))
      .send({ revision: current.body.revision, data: { ...current.body.data, enabled: true, ...overrides } })
      .expect(200);
  }

  /** Orden real (apartada) para usar como referencia de eventos con fecha controlada. */
  async function orderFor(t: TestOrg, slug: string, numbers: number[], name: string, phone = nextPhone()) {
    const res = await reserve(ctx, t, slug, { numbers, name, phone });
    const order = await ctx.db.system.order.findUniqueOrThrow({ where: { id: res.body.orderId } });
    return order;
  }

  const event = (t: TestOrg, o: { id: string; raffleId: string; participantId: string; numbers: number[] }, at: string): OrderEvent => ({
    type: 'approved',
    organizationId: t.org.id,
    orderId: o.id,
    raffleId: o.raffleId,
    participantId: o.participantId,
    numbers: o.numbers,
    previousStatus: 'pending_verification',
    actorMemberId: null,
    at: new Date(at),
  });

  it('rollover en el cambio de mes según la zona horaria de la organización (America/Bogota)', async () => {
    const t = await createOrg(ctx);
    await enableRanking(t);
    const raffle = await createRaffle(ctx, t);
    const a = await orderFor(t, raffle.slug, [1, 2], 'Laura Martínez');
    const b = await orderFor(t, raffle.slug, [3], 'Carlos Rincón');

    // 31 oct 23:59:59 en Bogotá = 1 nov 04:59:59 UTC → octubre.
    await ctx.db.tenantTx(t.org.id, (tx) => ranking.awardForApproval(tx, event(t, a, '2026-11-01T04:59:59Z')));
    // 1 nov 00:00:00 en Bogotá → noviembre (cierra octubre en la misma transacción).
    await ctx.db.tenantTx(t.org.id, (tx) => ranking.awardForApproval(tx, event(t, b, '2026-11-01T05:00:00Z')));

    const periods = await ctx.db.system.rankingPeriod.findMany({ where: { organizationId: t.org.id }, orderBy: { startsAt: 'asc' } });
    expect(periods.map((p) => [p.label, p.status])).toEqual([
      ['2026-10', 'closed'],
      ['2026-11', 'open'],
    ]);
    expect(periods[0].endsAt).toEqual(new Date('2026-11-01T05:00:00Z'));
    const snapshot = periods[0].snapshot as { name: string; points: number; maskedPhone: string }[];
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ name: 'Laura Martínez', points: 2 });
    expect(snapshot[0].maskedPhone).toMatch(/^\*\*\*\d{4}$/);
    expect(JSON.stringify(snapshot)).not.toContain('+57');
    expect(periods[0].configSnapshot).toMatchObject({ frequency: 'monthly', tiebreaker: 'first_to_reach' });

    // El job cierra noviembre a las 00:00 del 1 dic (hora de Bogotá) y es idempotente.
    const maintenance = ctx.app.get(MaintenanceService);
    expect(await ranking.rollover(t.org.id, new Date('2026-12-01T04:59:00Z'))).toBeNull();
    expect(await maintenance.rankingRollover(new Date('2026-12-01T05:00:00Z'))).toBeGreaterThanOrEqual(1);
    expect(await ranking.rollover(t.org.id, new Date('2026-12-01T05:00:00Z'))).toBeNull();
    const after = await ctx.db.system.rankingPeriod.findMany({ where: { organizationId: t.org.id }, orderBy: { startsAt: 'asc' } });
    expect(after.map((p) => [p.label, p.status])).toEqual([
      ['2026-10', 'closed'],
      ['2026-11', 'closed'],
      ['2026-12', 'open'],
    ]);
  });

  it('el mismo instante cae en meses distintos según la zona horaria', async () => {
    const madrid = await createOrg(ctx);
    await ctx.http.patch('/v1/organization').set(as(madrid.ownerToken, madrid.org.id)).send({ timezone: 'Europe/Madrid' }).expect(200);
    await enableRanking(madrid);
    const raffle = await createRaffle(ctx, madrid);
    const o = await orderFor(madrid, raffle.slug, [9], 'Andrés Gil');
    // 31 oct 23:30 UTC = 1 nov 00:30 en Madrid (CET) → noviembre; en Bogotá sería 31 oct.
    await ctx.db.tenantTx(madrid.org.id, (tx) => ranking.awardForApproval(tx, event(madrid, o, '2026-10-31T23:30:00Z')));
    const p = await ctx.db.system.rankingPeriod.findFirstOrThrow({ where: { organizationId: madrid.org.id } });
    expect(p.label).toBe('2026-11');
    expect(p.startsAt).toEqual(new Date('2026-10-31T23:00:00Z'));
  });

  describe('desempate', () => {
    let t: TestOrg;
    let periodId: string;
    let p1: string;
    let p2: string;

    beforeAll(async () => {
      t = await createOrg(ctx);
      await enableRanking(t);
      const r1 = await createRaffle(ctx, t);
      const r2 = await createRaffle(ctx, t);
      const o1 = await orderFor(t, r1.slug, [1, 2, 3], 'Primera Persona');
      const o2 = await orderFor(t, r2.slug, [4, 5], 'Primera Persona', (await ctx.db.system.participant.findUniqueOrThrow({ where: { id: o1.participantId } })).phone.slice(3));
      const o3 = await orderFor(t, r1.slug, [6, 7, 8, 9, 10], 'Segunda Persona');
      p1 = o1.participantId;
      p2 = o3.participantId;
      expect(o2.participantId).toBe(p1);
      const now = Date.now();
      const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
      // P1: 3 puntos hace 30 min + 2 hace 10 min = 5 (llega a 5 hace 10 min, en 2 sorteos).
      // P2: 5 puntos hace 20 min en 1 sorteo (llega a 5 primero).
      await ctx.db.tenantTx(t.org.id, async (tx) => {
        await ranking.awardForApproval(tx, event(t, o1, at(30)));
        await ranking.awardForApproval(tx, event(t, o3, at(20)));
        await ranking.awardForApproval(tx, event(t, o2, at(10)));
      });
      periodId = (await ctx.db.system.rankingPeriod.findFirstOrThrow({ where: { organizationId: t.org.id, status: 'open' } })).id;
    });

    it('por defecto gana quien llegó primero a esos puntos', async () => {
      const rows = await ctx.db.tenantTx(t.org.id, (tx) => ranking.standings(tx, periodId, 'first_to_reach'));
      expect(rows.map((r) => [r.participantId, r.points, r.raffles])).toEqual([
        [p2, 5, 1],
        [p1, 5, 2],
      ]);
    });

    it('configurado: gana quien jugó más sorteos', async () => {
      const rows = await ctx.db.tenantTx(t.org.id, (tx) => ranking.standings(tx, periodId, 'most_raffles'));
      expect(rows.map((r) => r.participantId)).toEqual([p1, p2]);
    });

    it('«llegar primero» usa el acumulado: bajar y volver a subir no adelanta', async () => {
      // P2 pierde 1 punto y lo recupera: ahora alcanza 5 en el último evento.
      const { token } = await addMember(ctx, t.org.id, 'admin');
      await ctx.http.post('/v1/ranking/adjustments').set(as(token, t.org.id)).send({ participantId: p2, points: -1, reason: 'Error de digitación' }).expect(201);
      await ctx.http.post('/v1/ranking/adjustments').set(as(token, t.org.id)).send({ participantId: p2, points: 1, reason: 'Corrección' }).expect(201);
      const rows = await ctx.db.tenantTx(t.org.id, (tx) => ranking.standings(tx, periodId, 'first_to_reach'));
      expect(rows.map((r) => r.participantId)).toEqual([p1, p2]);
    });
  });

  it('flujo completo: puntos al aprobar, reversión al liberar, ajustes, bonos y privacidad', async () => {
    const t = await createOrg(ctx);
    await enableRanking(t, {
      consistencyBonus: { enabled: true, minRaffles: 2, points: 5 },
      referralBonus: { enabled: true, points: 3 },
      prizes: ['$300.000 en efectivo', '10 números gratis'],
      publicTopSize: 10,
    });
    const r1 = await createRaffle(ctx, t);
    const r2 = await createRaffle(ctx, t);
    const lauraPhone = nextPhone();
    const o1 = await reserveAndSubmit(ctx, t, r1.slug, [1, 2], lauraPhone);
    await ctx.http.post(`/v1/orders/${o1.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);

    let current = await ctx.http.get('/v1/ranking/current').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(current.body.standings).toMatchObject([{ rank: 1, name: 'Laura Martínez', points: 2, raffles: 1, investedCop: 12_000 }]);

    // Segundo sorteo → bono de constancia (una sola vez).
    const o2 = await reserveAndSubmit(ctx, t, r2.slug, [5], lauraPhone);
    await ctx.http.post(`/v1/orders/${o2.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    const o3 = await reserveAndSubmit(ctx, t, r2.slug, [6], lauraPhone);
    await ctx.http.post(`/v1/orders/${o3.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    current = await ctx.http.get('/v1/ranking/current').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(current.body.standings[0]).toMatchObject({ points: 2 + 1 + 1 + 5, raffles: 2 });

    // Referido: Carlos llega con el código de Laura; Laura gana 3 puntos una vez.
    const laura = await ctx.db.system.participant.findFirstOrThrow({ where: { organizationId: t.org.id, phone: `+57${lauraPhone}` } });
    const carlos = await ctx.http
      .post(`/v1/public/orgs/${t.org.slug}/raffles/${r1.slug}/orders`)
      .send({ name: 'Carlos Rincón', phone: nextPhone(), numbers: [40], referralCode: laura.referralCode });
    expect(carlos.status).toBe(201);
    await ctx.http.post(`/v1/orders/${carlos.body.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    current = await ctx.http.get('/v1/ranking/current').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(current.body.standings.find((s: { name: string }) => s.name === 'Laura Martínez').points).toBe(9 + 3);

    // Liberar una orden aprobada revierte sus puntos con un evento negativo.
    await ctx.http.post(`/v1/orders/${carlos.body.orderId}/release`).set(as(t.ownerToken, t.org.id)).send({ reason: 'Reembolso' }).expect(200);
    current = await ctx.http.get('/v1/ranking/current').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(current.body.standings.map((s: { name: string }) => s.name)).toEqual(['Laura Martínez']);
    const reversal = await ctx.db.system.pointsEvent.findFirstOrThrow({ where: { orderId: carlos.body.orderId, points: { lt: 0 } } });
    expect(reversal).toMatchObject({ points: -1, reason: 'number_paid' });

    // Ajuste manual: requiere ranking.configure y queda auditado.
    const verifier = await addMember(ctx, t.org.id, 'payment_verifier');
    await ctx.http.post('/v1/ranking/adjustments').set(as(verifier.token, t.org.id)).send({ participantId: laura.id, points: 4, reason: 'Premio' }).expect(403);
    await ctx.http.post('/v1/ranking/adjustments').set(as(t.ownerToken, t.org.id)).send({ participantId: laura.id, points: 4, reason: 'Compra en efectivo' }).expect(201);
    expect(await ctx.db.system.auditLog.count({ where: { organizationId: t.org.id, action: 'ranking.manual_adjustment' } })).toBe(1);

    // El libro es inmutable.
    await expect(ctx.db.system.pointsEvent.updateMany({ where: { organizationId: t.org.id }, data: { points: 100 } })).rejects.toThrow(/inmutable/);
    await expect(ctx.db.system.pointsEvent.deleteMany({ where: { organizationId: t.org.id } })).rejects.toThrow(/inmutable/);

    // Público: nombre formateado y teléfono enmascarado.
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/ranking`).expect(200);
    expect(pub.body.top[0]).toEqual({ rank: 1, name: 'Laura M.', phone: `***${lauraPhone.slice(-4)}`, points: 16 });
    expect(pub.body.prizes).toEqual(['$300.000 en efectivo', '10 números gratis']);
    expect(pub.body.closesAt).toBeTruthy();
    expect(JSON.stringify(pub.body)).not.toContain(lauraPhone);

    // CSV del periodo.
    const csv = await ctx.http.get(`/v1/ranking/periods/${current.body.period.id}/export.csv`).set(as(t.ownerToken, t.org.id)).expect(200);
    expect(csv.text.split('\n')[1]).toContain('Laura Martínez');
  });

  it('formato de nombre por iniciales y periodo cerrado por etiqueta', async () => {
    const t = await createOrg(ctx);
    await enableRanking(t, { nameFormat: 'initials' });
    const raffle = await createRaffle(ctx, t);
    const o = await orderFor(t, raffle.slug, [1], 'Yeni Pacheco');
    await ctx.db.tenantTx(t.org.id, (tx) => ranking.awardForApproval(tx, event(t, o, '2026-09-15T15:00:00Z')));
    await ranking.rollover(t.org.id, new Date('2026-10-01T05:00:00Z'));
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/ranking?period=2026-09`).expect(200);
    expect(pub.body.period).toMatchObject({ label: '2026-09', status: 'closed' });
    expect(pub.body.top[0].name).toBe('Y. P.');
    await ctx.http.get(`/v1/public/orgs/${t.org.slug}/ranking?period=septiembre`).expect(400);
  });

  it('sin ranking activo el enlace público responde con un error claro', async () => {
    const t = await createOrg(ctx);
    const res = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/ranking`).expect(409);
    expect(res.body).toMatchObject({ code: 'RANKING_DISABLED', message: 'Esta organización no tiene ranking activo.' });
    const panel = await ctx.http.get('/v1/ranking/current').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(panel.body).toEqual({ enabled: false });
  });
});
