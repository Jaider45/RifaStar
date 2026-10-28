import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg, freshTotp } from './helpers';
import { createRaffle, nextPhone, reserve, reserveAndSubmit } from './fixtures';

describe('Resultados y ganadores', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  const approve = (orderId: string) => ctx.http.post(`/v1/orders/${orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
  const prizeByRule = (body: { prizes: { ruleLabel: string; winners: unknown[]; pending: boolean }[] }, label: string) =>
    body.prizes.find((p) => p.ruleLabel.startsWith(label))!;

  it('calcula cada premio de Boyacá; solo ganan números pagados', async () => {
    const raffle = await createRaffle(ctx, t);
    // Resultado 2435 → CD=35, AB=24, BC=43, AD=25; anticipado 9107 → 07.
    const laura = await reserveAndSubmit(ctx, t, raffle.slug, [35], nextPhone());
    await approve(laura.orderId);
    const carlos = await reserveAndSubmit(ctx, t, raffle.slug, [24, 7]);
    await approve(carlos.orderId);
    await reserveAndSubmit(ctx, t, raffle.slug, [43]); // en verificación: no gana
    await reserve(ctx, t, raffle.slug, { numbers: [25] }); // apartado: no gana

    const res = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(as(t.ownerToken, t.org.id))
      .send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '2435' })
      .expect(200);
    expect(res.body.result).toMatchObject({ mainResult: '2435', anticipatedResult: null, revision: 1 });
    expect(prizeByRule(res.body, 'Dos últimas').winners).toMatchObject([{ number: '35', unsold: false, label: 'Laura Martínez' }]);
    expect(prizeByRule(res.body, 'Dos primeras').winners).toMatchObject([{ number: '24', unsold: false }]);
    expect(prizeByRule(res.body, 'Dos del medio').winners).toMatchObject([{ number: '43', unsold: true, label: 'No vendido' }]);
    expect(prizeByRule(res.body, 'Dígito #1 y #4').winners).toMatchObject([{ number: '25', unsold: true }]);
    const anticipated = prizeByRule(res.body, 'Anticipado');
    expect(anticipated).toMatchObject({ pending: true, pendingReason: 'Falta el resultado del anticipado.' });

    // La venta quedó cerrada y el apartado sin pagar venció.
    const r = await ctx.db.system.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
    expect(r.status).toBe('closed');

    // Publicar exige todos los premios calculados.
    const incomplete = await ctx.http.post(`/v1/raffles/${raffle.id}/results/publish`).set(as(t.ownerToken, t.org.id)).expect(422);
    expect(incomplete.body.code).toBe('RESULTS_INCOMPLETE');

    // Corrección con el anticipado: se conservan las filas que no cambian.
    const winnerBefore = await ctx.db.system.winner.findFirstOrThrow({ where: { raffleId: raffle.id, number: 35 } });
    const fixed = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(as(t.ownerToken, t.org.id))
      .send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '2435', anticipatedResult: '9107' })
      .expect(200);
    expect(fixed.body.result.revision).toBe(2);
    expect(prizeByRule(fixed.body, 'Anticipado').winners).toMatchObject([{ number: '07', unsold: false }]);
    const winnerAfter = await ctx.db.system.winner.findFirstOrThrow({ where: { raffleId: raffle.id, number: 35 } });
    expect(winnerAfter.id).toBe(winnerBefore.id);
    expect(await ctx.db.system.auditLog.count({ where: { action: 'result.correct', organizationId: t.org.id } })).toBeGreaterThan(0);
  });

  it('entregar, proteger lo entregado y publicar con privacidad', async () => {
    const raffle = await createRaffle(ctx, t);
    const phone = nextPhone();
    const o = await reserveAndSubmit(ctx, t, raffle.slug, [87], phone);
    await approve(o.orderId);
    const entered = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(as(t.ownerToken, t.org.id))
      .send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '4087', anticipatedResult: '1187' })
      .expect(200);
    const lastTwo = prizeByRule(entered.body, 'Dos últimas').winners[0] as { id: string };

    const unsold = prizeByRule(entered.body, 'Dos primeras').winners[0] as { id: string };
    expect((await ctx.http.post(`/v1/winners/${unsold.id}/deliver`).set(as(t.ownerToken, t.org.id)).send({}).expect(409)).body.code).toBe('WINNER_UNSOLD');

    await ctx.http.post(`/v1/winners/${lastTwo.id}/deliver`).set(as(t.ownerToken, t.org.id)).send({ note: 'Transferido' }).expect(200);
    const blocked = await ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '4000', anticipatedResult: '1187' }).expect(409);
    expect(blocked.body.code).toBe('WINNER_ALREADY_DELIVERED');

    // Antes de publicar no hay resultados públicos.
    await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/results`).expect(404);

    const pub = await ctx.http.post(`/v1/raffles/${raffle.id}/results/publish`).set(as(t.ownerToken, t.org.id)).expect(200);
    expect(pub.body.raffle.status).toBe('drawn');
    await ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '1111' }).expect(409);

    const publicRes = await ctx.http.get(`/v1/public/orgs/${t.org.slug}/raffles/${raffle.slug}/results`).expect(200);
    expect(publicRes.body.result.mainResult).toBe('4087');
    const winner = publicRes.body.prizes[0].winners[0];
    expect(winner).toEqual({ number: '87', unsold: false, name: 'Laura M.', phone: `***${phone.slice(-4)}`, delivered: true });
    expect(publicRes.body.prizes[1].winners[0]).toMatchObject({ name: 'No vendido', phone: null });
    expect(JSON.stringify(publicRes.body)).not.toContain(phone);

    // Con el sorteo jugado ya no se aprueban ni liberan pagos.
    await ctx.http.post(`/v1/orders/${o.orderId}/release`).set(as(t.ownerToken, t.org.id)).send({ reason: 'Prueba' }).expect(409);
  });

  it('premios especiales con número manual y sorteos de 4 cifras', async () => {
    const raffle = await createRaffle(ctx, t, {
      digits: 4,
      prizes: [
        { amountCop: 5_000_000, rule: 'full_number' },
        { description: 'Moto Yamaha NMAX', rule: 'custom', customRuleText: 'Balota extra en vivo' },
      ],
    });
    const o = await reserveAndSubmit(ctx, t, raffle.slug, [715, 4087]);
    await approve(o.orderId);
    const customPrize = raffle.prizes[1].id;
    const res = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(as(t.ownerToken, t.org.id))
      .send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '4087', customWinners: [{ prizeId: customPrize, number: 715 }] })
      .expect(200);
    expect(res.body.prizes[0].winners[0]).toMatchObject({ number: '4087', unsold: false });
    expect(res.body.prizes[1].winners[0]).toMatchObject({ number: '0715', unsold: false });
    expect(res.body.prizes[1].ruleLabel).toBe('Balota extra en vivo');

    const bad = await ctx.http
      .put(`/v1/raffles/${raffle.id}/result`)
      .set(as(t.ownerToken, t.org.id))
      .send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '4087', customWinners: [{ prizeId: raffle.prizes[0].id, number: 1 }] })
      .expect(400);
    expect(bad.body.message).toBe('Solo los premios con regla especial llevan número manual.');
  });

  it('solo quien tiene winners.announce registra resultados', async () => {
    const verifier = await addMember(ctx, t.org.id, 'payment_verifier');
    const raffle = await createRaffle(ctx, t);
    await ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(verifier.token, t.org.id)).send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '1234' }).expect(403);
    await ctx.http.get(`/v1/raffles/${raffle.id}/winners`).set(as(verifier.token, t.org.id)).expect(200);
    const fmt = await ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '123' }).expect(400);
    expect(fmt.body.details[0].message).toBe('El resultado tiene 4 dígitos (por ejemplo 0507).');
  });
});
