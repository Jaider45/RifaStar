import { decodeGrid2b } from '../src/public/grid-encoding';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';
import { BOYACA_PRIZES, createRaffle, ensurePaymentAccount, inHours, reserve, reserveAndSubmit } from './fixtures';

describe('Sorteos', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  const base = (extra: object = {}) => ({
    title: 'Gana con Boyacá · Sorteo semanal',
    lottery: 'Lotería de Boyacá',
    drawAt: inHours(48),
    salesCloseAt: inHours(40),
    pricePerNumber: 6000,
    digits: 2,
    prizes: BOYACA_PRIZES,
    ...extra,
  });

  it('crea borradores con slug automático, consecutivo y etiquetas de premio', async () => {
    const a = await ctx.http.post('/v1/raffles').set(as(t.ownerToken, t.org.id)).send(base()).expect(201);
    const b = await ctx.http.post('/v1/raffles').set(as(t.ownerToken, t.org.id)).send(base()).expect(201);
    expect(a.body).toMatchObject({ status: 'draft', slug: 'gana-con-boyaca-sorteo-semanal', totalNumbers: 100 });
    expect(b.body.slug).toBe('gana-con-boyaca-sorteo-semanal-2');
    expect(b.body.sequence).toBe(a.body.sequence + 1);
    expect(a.body.prizes.map((p: { ruleLabel: string }) => p.ruleLabel)).toEqual([
      'Dos últimas cifras',
      'Dos primeras cifras',
      'Dos del medio',
      'Dígito #1 y #4',
      'Anticipado con Antioqueñita (dos últimas cifras)',
    ]);
  });

  it('rechaza reglas de 2 cifras en sorteos de 4 cifras (P3) y fechas incoherentes', async () => {
    const bad = await ctx.http.post('/v1/raffles').set(as(t.ownerToken, t.org.id)).send(base({ digits: 4 })).expect(400);
    expect(bad.body.message).toBe('La regla «last_two» no aplica a sorteos de 4 cifras.');
    const dates = await ctx.http
      .post('/v1/raffles')
      .set(as(t.ownerToken, t.org.id))
      .send(base({ salesCloseAt: inHours(50) }))
      .expect(400);
    expect(dates.body.message).toBe('El cierre de ventas debe ser antes del sorteo.');
  });

  it('publicar exige cuenta de pago y crea todas las filas de números', async () => {
    const fresh = await createOrg(ctx);
    const draft = await ctx.http.post('/v1/raffles').set(as(fresh.ownerToken, fresh.org.id)).send(base({ digits: 3, prizes: [{ amountCop: 1_000_000, rule: 'last_three' }] })).expect(201);
    const notReady = await ctx.http.post(`/v1/raffles/${draft.body.id}/publish`).set(as(fresh.ownerToken, fresh.org.id)).expect(422);
    expect(notReady.body).toMatchObject({ code: 'RAFFLE_NOT_READY' });
    expect(notReady.body.message).toContain('Agrega al menos una cuenta para recibir pagos.');

    await ensurePaymentAccount(ctx, fresh);
    const pub = await ctx.http.post(`/v1/raffles/${draft.body.id}/publish`).set(as(fresh.ownerToken, fresh.org.id)).expect(200);
    expect(pub.body.status).toBe('active');
    expect(pub.body.paymentAccountIds).toHaveLength(1);
    expect(await ctx.db.system.raffleNumber.count({ where: { raffleId: draft.body.id } })).toBe(1000);

    // El job de cierre de ventas quedó programado a la hora límite.
    const jobId = SchedulerService.closeSalesJobId(draft.body.id, new Date(pub.body.salesCloseAt));
    const job = await ctx.app.get(SchedulerService).maintenance.getJob(jobId);
    expect(job?.data).toMatchObject({ raffleId: draft.body.id });
    expect(await job!.isDelayed()).toBe(true);
  });

  it('después de publicar no cambian cifras, precio ni dirección', async () => {
    const raffle = await createRaffle(ctx, t);
    const res = await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ pricePerNumber: 7000 }).expect(409);
    expect(res.body).toMatchObject({ code: 'RAFFLE_LOCKED_FIELD', details: { fields: ['pricePerNumber'] } });
    await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ conditionText: 'Pagos antes de las 3:30 p. m.' }).expect(200);
  });

  it('duplicar crea un borrador con los mismos premios', async () => {
    const raffle = await createRaffle(ctx, t);
    const copy = await ctx.http.post(`/v1/raffles/${raffle.id}/duplicate`).set(as(t.ownerToken, t.org.id)).send({}).expect(201);
    expect(copy.body).toMatchObject({ status: 'draft', title: `${raffle.title} (copia)` });
    expect(copy.body.prizes).toHaveLength(5);
    expect(copy.body.paymentAccountIds).toEqual(raffle.paymentAccountIds);
  });

  it('eliminar solo borradores; cancelar libera los apartados y conserva lo pagado', async () => {
    const draft = await createRaffle(ctx, t, { publish: false });
    const live = await createRaffle(ctx, t);
    await ctx.http.delete(`/v1/raffles/${live.id}`).set(as(t.ownerToken, t.org.id)).expect(409);
    await ctx.http.delete(`/v1/raffles/${draft.id}`).set(as(t.ownerToken, t.org.id)).expect(204);
    await ctx.http.get(`/v1/raffles/${draft.id}`).set(as(t.ownerToken, t.org.id)).expect(404);

    const reserved = await reserve(ctx, t, live.slug, { numbers: [1, 2] });
    const paid = await reserveAndSubmit(ctx, t, live.slug, [3]);
    await ctx.http.post(`/v1/orders/${paid.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);

    const res = await ctx.http.post(`/v1/raffles/${live.id}/cancel`).set(as(t.ownerToken, t.org.id)).send({ reason: 'Lluvia' }).expect(200);
    expect(res.body.status).toBe('cancelled');
    const order = await ctx.db.system.order.findUniqueOrThrow({ where: { id: reserved.body.orderId } });
    expect(order.status).toBe('expired');
    const nums = await ctx.db.system.raffleNumber.findMany({ where: { raffleId: live.id, number: { in: [1, 2, 3] } }, orderBy: { number: 'asc' } });
    expect(nums.map((n) => n.status)).toEqual(['available', 'available', 'paid']);
  });

  it('el admin no puede eliminar (raffles.delete); el vendedor no puede editar', async () => {
    const admin = await addMember(ctx, t.org.id, 'admin');
    const seller = await addMember(ctx, t.org.id, 'seller');
    const draft = await createRaffle(ctx, t, { publish: false });
    await ctx.http.delete(`/v1/raffles/${draft.id}`).set(as(admin.token, t.org.id)).expect(403);
    await ctx.http.patch(`/v1/raffles/${draft.id}`).set(as(seller.token, t.org.id)).send({ title: 'Otro título' }).expect(403);
    await ctx.http.get(`/v1/raffles/${draft.id}`).set(as(seller.token, t.org.id)).expect(200);
  });

  it('enlace público: datos, avance y grilla comprimida', async () => {
    const raffle = await createRaffle(ctx, t);
    await reserve(ctx, t, raffle.slug, { numbers: [5] });
    const paid = await reserveAndSubmit(ctx, t, raffle.slug, [9]);
    await ctx.http.post(`/v1/orders/${paid.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    await reserveAndSubmit(ctx, t, raffle.slug, [11]);

    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(pub.headers['cache-control']).toContain('max-age=15');
    expect(pub.body.raffle).toMatchObject({ title: raffle.title, pricePerNumber: 6000, digits: 2, status: 'active' });
    expect(pub.body.progress).toEqual({ paid: 1, held: 2, available: 97, soldPercent: 1 });
    expect(pub.body.paymentAccounts[0]).toMatchObject({ typeLabel: 'Llave Bre-B', keyOrNumber: '3168110777', holderName: 'José Rodríguez' });
    expect(JSON.stringify(pub.body)).not.toMatch(/\+57/);

    const grid = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/numbers`).expect(200);
    expect(grid.body).toMatchObject({ total: 100, encoding: 'bitset-2b', availableCount: 97 });
    const states = decodeGrid2b(Buffer.from(grid.body.data, 'base64'), 100);
    expect([states[5], states[9], states[11], states[0]]).toEqual(['reserved', 'paid', 'pending_verification', 'available']);

    const etag = grid.headers.etag;
    await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/numbers`).set('If-None-Match', etag).expect(304);
  });

  it('la grilla de 10.000 números pesa pocos KB', async () => {
    const raffle = await createRaffle(ctx, t, { digits: 4 });
    const grid = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/numbers`).expect(200);
    expect(Buffer.from(grid.body.data, 'base64').length).toBe(2500);
    const avail = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/numbers?status=available`).expect(200);
    expect(Buffer.from(avail.body.data, 'base64').length).toBe(1250);
  });

  it('los borradores no son públicos', async () => {
    const draft = await createRaffle(ctx, t, { publish: false });
    const res = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${draft.slug}`).expect(404);
    expect(res.body.message).toBe('No encontramos el sorteo.');
  });
});
