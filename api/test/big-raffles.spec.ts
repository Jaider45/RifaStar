import { createRaffle, ensurePaymentAccount, inHours, nextPhone, reserve, reserveAndSubmit } from './fixtures';
import { as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg, totp } from './helpers';

describe('Sorteos de 5 y 6 cifras, selección al azar y compra mínima por participante', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
    await ensurePaymentAccount(ctx, t);
  });
  afterAll(() => closeTestApp(ctx));

  const base = (over: Record<string, unknown>) => ({
    title: `Moto ${Date.now()}`,
    lottery: 'Lotería de Boyacá',
    drawAt: inHours(48),
    pricePerNumber: 2000,
    prizes: [{ amountCop: 5_000_000, rule: 'full_number' }],
    ...over,
  });

  it('5 cifras pide de dónde sale la quinta; 6 cifras solo con la serie', async () => {
    const post = (body: object) => ctx.http.post('/v1/raffles').set(as(t.ownerToken, t.org.id)).send(body);
    const missing = await post(base({ digits: 5 })).expect(400);
    expect(missing.body.details[0].message).toContain('quinta cifra');
    const sixFifth = await post(base({ digits: 6, extraDigitsSource: 'fifth_digit' })).expect(400);
    expect(sixFifth.body.details[0].message).toContain('6 cifras');
    const fourExtra = await post(base({ digits: 4, extraDigitsSource: 'series' })).expect(400);
    expect(fourExtra.body.details[0].message).toContain('solo con la lotería');
    const six = await post(base({ digits: 6, extraDigitsSource: 'series', extraDigitsPosition: 'start' })).expect(201);
    expect(six.body).toMatchObject({ digits: 6, totalNumbers: 1_000_000, extraDigitsSource: 'series', extraDigitsPosition: 'start' });
  });

  it('grilla por bloques de 1.000 y apartado atómico en 1.000.000 de números', async () => {
    const raffle = await createRaffle(ctx, t, { digits: 6 });
    expect(await ctx.db.system.raffleNumber.count({ where: { raffleId: raffle.id } })).toBe(0);

    const results = await Promise.all(Array.from({ length: 20 }, () => reserve(ctx, t, raffle.slug, { numbers: [654321] })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.details.takenFormatted[0] === '654321')).toBe(true);

    const rnd = await reserve(ctx, t, raffle.slug, { random: 5 });
    expect(rnd.status).toBe(201);
    expect(new Set(rnd.body.numbersRaw).size).toBe(5);
    expect(rnd.body.numbers.every((n: string) => /^\d{6}$/.test(n))).toBe(true);

    const summary = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/numbers`).expect(200);
    expect(summary.body).toMatchObject({ encoding: 'blocks', blockSize: 1000, availableCount: 1_000_000 - 6 });
    expect(summary.body.blocks).toHaveLength(1000);
    expect(summary.body.blocks[654]).toBe(999);

    const block = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/numbers?block=654`).expect(200);
    expect(block.body).toMatchObject({ encoding: 'bitset-2b', offset: 654_000, size: 1000 });
  });

  it('el número completo se arma con la serie (al final o al inicio) y gana solo si está pago', async () => {
    const end = await createRaffle(ctx, t, { digits: 5 });
    const start = await createRaffle(ctx, t, { digits: 5, extra: { extraDigitsPosition: 'start' } });
    for (const [raffle, winner] of [[end, 40587], [start, 74058]] as const) {
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [winner]);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      const put = (body: object) => ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: totp(), ...body });
      const noSeries = await put({ mainResult: '4058' }).expect(400);
      expect(noSeries.body.message).toContain('serie');
      const res = await put({ mainResult: '4058', seriesResult: '127' }).expect(200);
      expect(res.body.result.label).toBe(`4058 · serie 127 → ${winner}`);
      expect(res.body.prizes[0].winners[0]).toMatchObject({ number: String(winner), unsold: false });
    }
  });

  it('quinta cifra del chance', async () => {
    const raffle = await createRaffle(ctx, t, { digits: 5, extra: { extraDigitsSource: 'fifth_digit' } });
    const res = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(as(t.ownerToken, t.org.id))
      .send({ totpCode: totp(), mainResult: '0507', fifthDigit: '3' })
      .expect(200);
    expect(res.body.prizes[0].winners[0]).toMatchObject({ number: '05073', unsold: true, label: 'No vendido' });
  });

  it('modo «solo al azar»: el participante elige cuántos, no cuáles', async () => {
    const raffle = await createRaffle(ctx, t, { digits: 3, extra: { numberSelection: 'random' } });
    const chosen = await reserve(ctx, t, raffle.slug, { numbers: [123] });
    expect(chosen.status).toBe(400);
    expect(chosen.body.message).toBe('En este sorteo los números se asignan al azar. Elige cuántos quieres.');
    const rnd = await reserve(ctx, t, raffle.slug, { random: 4 });
    expect(rnd.status).toBe(201);
    expect(rnd.body.numbers).toHaveLength(4);
  });

  it('compra mínima por participante: cuenta lo que ya tiene en el sorteo', async () => {
    const raffle = await createRaffle(ctx, t, { minPerOrder: 3 });
    const phone = nextPhone();
    const few = await reserve(ctx, t, raffle.slug, { numbers: [1, 2], phone });
    expect(few.status).toBe(400);
    expect(few.body.message).toBe('La compra mínima en este sorteo es de 3 números por participante.');
    expect((await reserve(ctx, t, raffle.slug, { numbers: [1, 2, 3], phone })).status).toBe(201);
    // Ya llegó al mínimo: puede sumar de a uno.
    expect((await reserve(ctx, t, raffle.slug, { numbers: [4], phone })).status).toBe(201);
  });

  it('después de publicar no cambian las cifras, el modo ni la compra mínima', async () => {
    const raffle = await createRaffle(ctx, t, { digits: 5 });
    const res = await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).send({ numberSelection: 'random', minPerOrder: 5 }).expect(409);
    expect(res.body).toMatchObject({ code: 'RAFFLE_LOCKED_FIELD', details: { fields: ['numberSelection', 'minPerOrder'] } });
  });
});
