import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';
import { createRaffle, nextPhone, reserve } from './fixtures';

describe('Apartado atómico de números', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  it('50 solicitudes simultáneas por el mismo número → solo 1 gana', async () => {
    const raffle = await createRaffle(ctx, t);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) => reserve(ctx, t, raffle.slug, { numbers: [7], name: `Persona ${i}` })),
    );
    const won = results.filter((r) => r.status === 201);
    const lost = results.filter((r) => r.status === 409);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(49);
    for (const r of lost) {
      expect(r.body.code).toBe('NUMBERS_TAKEN');
      expect(r.body.message).toBe('El número 07 ya fue apartado por otra persona. Elige otro.');
      expect(r.body.details.taken).toEqual([7]);
    }

    const rows = await ctx.db.system.raffleNumber.findMany({ where: { raffleId: raffle.id, number: 7 } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'reserved', orderId: won[0].body.orderId });
    const orders = await ctx.db.system.order.count({ where: { raffleId: raffle.id } });
    expect(orders).toBe(1); // las 49 transacciones perdedoras se revirtieron por completo
    const r = await ctx.db.system.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
    expect(r.heldCount).toBe(1);
  });

  it('órdenes de varios números que se cruzan: todo o nada', async () => {
    const raffle = await createRaffle(ctx, t);
    const [a, b] = await Promise.all([
      reserve(ctx, t, raffle.slug, { numbers: [10, 11, 12] }),
      reserve(ctx, t, raffle.slug, { numbers: [12, 13, 14] }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const loser = a.status === 409 ? a : b;
    expect(loser.body.details.taken).toEqual([12]);

    const reserved = await ctx.db.system.raffleNumber.findMany({
      where: { raffleId: raffle.id, status: { not: 'available' } },
      orderBy: { number: 'asc' },
    });
    // Solo quedan apartados los números del ganador; los libres del perdedor no.
    const winnerNumbers = (a.status === 201 ? [10, 11, 12] : [12, 13, 14]);
    expect(reserved.map((n) => n.number)).toEqual(winnerNumbers);
  });

  it('compras cruzadas en orden inverso no se bloquean entre sí', async () => {
    const raffle = await createRaffle(ctx, t);
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => reserve(ctx, t, raffle.slug, { numbers: i % 2 ? [30, 31, 32, 33] : [33, 32, 31, 30] })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.every((r) => r.status === 201 || r.body.code === 'NUMBERS_TAKEN')).toBe(true);
  });

  it('random: N números distintos; si no alcanzan, error claro', async () => {
    const raffle = await createRaffle(ctx, t);
    const res = await reserve(ctx, t, raffle.slug, { random: 5 });
    expect(res.status).toBe(201);
    expect(new Set(res.body.numbersRaw).size).toBe(5);
    expect(res.body.totalCop).toBe(30_000);

    const all = await reserve(ctx, t, raffle.slug, { random: 95 });
    expect(all.status).toBe(201);
    const none = await reserve(ctx, t, raffle.slug, { random: 1 });
    expect(none.status).toBe(409);
    expect(none.body).toMatchObject({ code: 'NOT_ENOUGH_NUMBERS', message: 'Ya no quedan números disponibles.' });
  });

  it('valida mínimo por compra, rango y formato del teléfono', async () => {
    const raffle = await createRaffle(ctx, t, { minPerOrder: 2 });
    const min = await reserve(ctx, t, raffle.slug, { numbers: [1] });
    expect(min.status).toBe(400);
    expect(min.body.message).toBe('La compra mínima en este sorteo es de 2 números por participante.');

    const range = await reserve(ctx, t, raffle.slug, { numbers: [5, 150] });
    expect(range.status).toBe(400);
    expect(range.body.message).toBe('Este sorteo va del 00 al 99.');

    const phone = await reserve(ctx, t, raffle.slug, { numbers: [1, 2], phone: '123' });
    expect(phone.status).toBe(400);

    const both = await reserve(ctx, t, raffle.slug, { numbers: [1, 2], random: 2 } as never);
    expect(both.status).toBe(400);
  });

  it('normaliza el WhatsApp a E.164 (+57 por defecto) y reutiliza al participante', async () => {
    const raffle = await createRaffle(ctx, t);
    const local = nextPhone();
    const first = await reserve(ctx, t, raffle.slug, { numbers: [40], phone: local, name: 'Carlos Rincón' });
    const second = await reserve(ctx, t, raffle.slug, { numbers: [41], phone: `+57 ${local.slice(0, 3)} ${local.slice(3)}`, name: 'Carlos R.' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const participants = await ctx.db.system.participant.findMany({ where: { organizationId: t.org.id, phone: `+57${local}` } });
    expect(participants).toHaveLength(1);
    expect(participants[0].name).toBe('Carlos R.');
  });

  it('Idempotency-Key: el reintento devuelve la misma orden', async () => {
    const raffle = await createRaffle(ctx, t);
    const phone = nextPhone();
    const send = () =>
      ctx.http
        .post(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/orders`)
        .set('Idempotency-Key', 'reintento-0001-abcd')
        .send({ name: 'Yeni Pacheco', phone, numbers: [55] });
    const [a, b] = await Promise.all([send(), send()]);
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(a.body.orderId).toBe(b.body.orderId);
    expect(a.body.accessToken).toBe(b.body.accessToken);
  });

  it('atribuye la venta al vendedor por su código', async () => {
    const seller = await addMember(ctx, t.org.id, 'seller', { sellerCode: 'LUIS' });
    const raffle = await createRaffle(ctx, t);
    const res = await reserve(ctx, t, raffle.slug, { numbers: [60, 61], sellerCode: 'luis' });
    expect(res.status).toBe(201);
    const order = await ctx.db.system.order.findUniqueOrThrow({ where: { id: res.body.orderId } });
    expect(order).toMatchObject({ sellerMemberId: seller.member.id, sellerCode: 'LUIS' });

    const mine = await ctx.http.get('/v1/sales/mine').set(as(seller.token, t.org.id)).expect(200);
    expect(mine.body.summary.orders).toBe(1);
    expect(mine.body.items[0].participant.phone).toMatch(/^\*\*\*\d{4}$/); // sin view_contact

    // Un código inexistente no bloquea la compra.
    const unknown = await reserve(ctx, t, raffle.slug, { numbers: [62], sellerCode: 'NADIE' });
    expect(unknown.status).toBe(201);
  });

  it('limita las solicitudes por teléfono', async () => {
    const raffle = await createRaffle(ctx, t);
    const phone = nextPhone();
    const results = [];
    for (let i = 0; i < 11; i++) results.push(await reserve(ctx, t, raffle.slug, { numbers: [i + 70], phone }));
    expect(results.slice(0, 10).every((r) => r.status === 201)).toBe(true);
    expect(results[10].status).toBe(429);
    expect(results[10].body.code).toBe('RATE_LIMITED');
    expect(results[10].headers['retry-after']).toBeTruthy();
  });

  it('el mismo teléfono es un participante distinto en cada organización', async () => {
    const other = await createOrg(ctx);
    const r1 = await createRaffle(ctx, t);
    const r2 = await createRaffle(ctx, other);
    const phone = nextPhone();
    await reserve(ctx, t, r1.slug, { numbers: [1], phone }).then((r) => expect(r.status).toBe(201));
    await reserve(ctx, other, r2.slug, { numbers: [1], phone }).then((r) => expect(r.status).toBe(201));
    const rows = await ctx.db.system.participant.findMany({ where: { phone: `+57${phone}` } });
    expect(new Set(rows.map((p) => p.organizationId)).size).toBe(2);
  });
});
