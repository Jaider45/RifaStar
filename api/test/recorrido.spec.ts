import { createRaffle, nextPhone, reserveAndSubmit } from './fixtures';
import { addMember, as, closeTestApp, createOrg, createTestApp, freshTotp, type TestContext, type TestOrg } from './helpers';

/**
 * Recorrido completo, de punta a punta por la API, como lo viven el organizador y el participante:
 * crear y publicar → ver la página pública → apartar y pagar → verificar → comprobante →
 * corregir la fecha con ventas → resultado con 2FA → ganador → entrega → publicar resultados.
 */
describe('Recorrido completo de un sorteo', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  it('de la publicación a la entrega del premio', async () => {
    const owner = as(t.ownerToken, t.org.id);
    const verifier = await addMember(ctx, t.org.id, 'payment_verifier');

    // 1. El organizador publica un sorteo de 2 cifras con un premio a las dos últimas.
    const raffle = await createRaffle(ctx, t, { prizes: [{ amountCop: 300_000, rule: 'last_two' }] });
    const pub = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(pub.body.raffle).toMatchObject({ title: raffle.title, status: 'active' });
    expect(pub.body.prizes[0]).toMatchObject({ amountCop: 300_000, ruleLabel: 'Dos últimas cifras' });

    // 2. Laura aparta el 35, paga y sube su comprobante de pago.
    const phone = nextPhone();
    const laura = await reserveAndSubmit(ctx, t, raffle.slug, [35], phone);
    const pending = await ctx.http.get('/v1/payments/queue').set(as(verifier.token, t.org.id)).expect(200);
    expect(pending.body.map((o: { id: string }) => o.id)).toContain(laura.orderId);

    // 3. La verificadora aprueba: sale el boleto y el número queda pagado.
    const approved = await ctx.http.post(`/v1/orders/${laura.orderId}/approve`).set(as(verifier.token, t.org.id)).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved' });
    expect(approved.body.tickets).toHaveLength(1);

    // 4. Comprobante de ingreso de la compra.
    const receipt = await ctx.http.post(`/v1/receipts/orders/${laura.orderId}`).set(owner).expect(201);
    expect(receipt.body.snapshot.purchase).toMatchObject({ numbers: ['35'], totalCop: 6000 });

    // 5. Con ventas, solo se corrige la fecha: el precio ya no cambia.
    await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(owner).send({ pricePerNumber: 9000 }).expect(409);
    const drawAt = new Date(Date.now() + 50 * 3_600_000).toISOString();
    await ctx.http.patch(`/v1/raffles/${raffle.id}`).set(owner).send({ drawAt, salesCloseAt: null }).expect(200);

    // 6. Juega la lotería: el resultado se confirma con un código de 2FA y Laura gana.
    const result = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(owner)
      .send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '2435' })
      .expect(200);
    expect(result.body.prizes[0].winners).toMatchObject([{ number: '35', unsold: false, label: 'Laura Martínez' }]);

    // 7. Se entrega el premio y se publican los resultados.
    const winner = await ctx.db.system.winner.findFirstOrThrow({ where: { raffleId: raffle.id, number: 35 } });
    await ctx.http.post(`/v1/winners/${winner.id}/deliver`).set(owner).send({ note: 'Transferido' }).expect(200);
    await ctx.http.post(`/v1/raffles/${raffle.id}/results/publish`).set(owner).expect(200);

    const final = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}`).expect(200);
    expect(final.body.raffle).toMatchObject({ resultsPublished: true });
  });
});
