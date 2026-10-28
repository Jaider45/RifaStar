import { createRaffle, reserveAndSubmit } from './fixtures';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';

describe('Comprobantes de ingreso', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  /** Compra aprobada en un sorteo nuevo. */
  async function approvedOrder(org: TestOrg, numbers = [7]) {
    const raffle = await createRaffle(ctx, org);
    const o = await reserveAndSubmit(ctx, org, raffle.slug, numbers);
    await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(org.ownerToken, org.org.id)).expect(200);
    return { raffle, orderId: o.orderId };
  }
  const issue = (org: TestOrg, orderId: string) => ctx.http.post(`/v1/receipts/orders/${orderId}`).set(as(org.ownerToken, org.org.id));

  it('se emite una vez por compra aprobada, con consecutivo propio de cada organización', async () => {
    const org = await createOrg(ctx);
    const a = await approvedOrder(org, [3, 1]);
    const b = await approvedOrder(org);
    const first = await issue(org, a.orderId).expect(201);
    expect(first.body).toMatchObject({ sequence: 1, voidedAt: null, raffleCancelled: false });
    expect(first.body.snapshot.purchase).toMatchObject({ quantity: 2, numbers: ['01', '03'], totalCop: 12_000 });
    // Repetir no emite otro: devuelve el mismo.
    expect((await issue(org, a.orderId).expect(201)).body.id).toBe(first.body.id);
    expect((await issue(org, b.orderId).expect(201)).body.sequence).toBe(2);

    const other = await createOrg(ctx);
    const c = await approvedOrder(other);
    expect((await issue(other, c.orderId).expect(201)).body.sequence).toBe(1);
    // Aislamiento: la otra organización no lo ve.
    await ctx.http.get(`/v1/receipts/${first.body.id}`).set(as(other.ownerToken, other.org.id)).expect(404);
  });

  it('solo compras aprobadas y solo con permiso', async () => {
    const raffle = await createRaffle(ctx, t);
    const pending = await reserveAndSubmit(ctx, t, raffle.slug, [9]);
    expect((await issue(t, pending.orderId).expect(409)).body.code).toBe('RECEIPT_ORDER_NOT_APPROVED');
    const seller = await addMember(ctx, t.org.id, 'seller');
    await ctx.http.get('/v1/receipts').set(as(seller.token, t.org.id)).expect(403);
  });

  it('es inmutable: no se edita ni se borra en la base de datos', async () => {
    const { orderId } = await approvedOrder(t);
    const r = (await issue(t, orderId).expect(201)).body;
    await expect(ctx.db.system.incomeReceipt.update({ where: { id: r.id }, data: { sequence: 99 } })).rejects.toThrow();
    await expect(ctx.db.system.incomeReceipt.delete({ where: { id: r.id } })).rejects.toThrow();
  });

  it('al liberar la compra, su comprobante queda anulado', async () => {
    const { orderId } = await approvedOrder(t);
    const r = (await issue(t, orderId).expect(201)).body;
    await ctx.http.post(`/v1/orders/${orderId}/release`).set(as(t.ownerToken, t.org.id)).send({ reason: 'Reembolso' }).expect(200);
    const after = await ctx.http.get(`/v1/receipts/${r.id}`).set(as(t.ownerToken, t.org.id)).expect(200);
    expect(after.body).toMatchObject({ voidReason: 'Reembolso' });
    expect(after.body.voidedAt).not.toBeNull();
  });

  it('sorteo cancelado: el comprobante sigue vigente hasta que el organizador decida anularlo', async () => {
    const org = await createOrg(ctx);
    const { raffle, orderId } = await approvedOrder(org);
    const r = (await issue(org, orderId).expect(201)).body;
    await ctx.http.post(`/v1/raffles/${raffle.id}/cancel`).set(as(org.ownerToken, org.org.id)).send({ reason: 'No se completó la venta' }).expect(200);

    const list = await ctx.http.get('/v1/receipts').set(as(org.ownerToken, org.org.id)).expect(200);
    expect(list.body.vigentesCancelados).toBe(1);
    expect(list.body.items[0]).toMatchObject({ id: r.id, raffleCancelled: true, voidedAt: null });

    // Anular a mano exige motivo y el permiso de liberar pagos (la verificadora no lo tiene).
    const verifier = await addMember(ctx, org.org.id, 'payment_verifier');
    await ctx.http.post(`/v1/receipts/${r.id}/void`).set(as(verifier.token, org.org.id)).send({ reason: 'Devolución' }).expect(403);
    await ctx.http.post(`/v1/receipts/${r.id}/void`).set(as(org.ownerToken, org.org.id)).send({ reason: '' }).expect(400);
    const voided = await ctx.http.post(`/v1/receipts/${r.id}/void`).set(as(org.ownerToken, org.org.id)).send({ reason: 'Sorteo cancelado: dinero devuelto' }).expect(200);
    expect(voided.body).toMatchObject({ voidReason: 'Sorteo cancelado: dinero devuelto', raffleCancelled: true });
    const again = await ctx.http.post(`/v1/receipts/${r.id}/void`).set(as(org.ownerToken, org.org.id)).send({ reason: 'Otra vez' }).expect(409);
    expect(again.body.code).toBe('RECEIPT_ALREADY_VOIDED');
    expect((await ctx.http.get('/v1/receipts').set(as(org.ownerToken, org.org.id)).expect(200)).body.vigentesCancelados).toBe(0);
    expect(await ctx.db.system.auditLog.findFirst({ where: { organizationId: org.org.id, action: 'receipt.void', entityId: r.id } })).not.toBeNull();
  });

  it('las listas se recorren por páginas, sin repetir ni saltar', async () => {
    const org = await createOrg(ctx);
    const orders: string[] = [];
    for (let i = 0; i < 5; i++) orders.push((await approvedOrder(org, [i])).orderId);
    for (const id of orders.slice(0, 3)) await issue(org, id).expect(201);

    const walk = async (path: string, key: 'id' | 'orderId') => {
      const seen: string[] = [];
      let cursor: string | null = null;
      do {
        const res: { body: { items: Record<string, string>[]; nextCursor: string | null } } = await ctx.http
          .get(path)
          .query({ limit: 2, ...(cursor && { cursor }) })
          .set(as(org.ownerToken, org.org.id))
          .expect(200);
        expect(res.body.items.length).toBeLessThanOrEqual(2);
        seen.push(...res.body.items.map((i) => i[key]));
        cursor = res.body.nextCursor;
      } while (cursor);
      return seen;
    };
    const issued = await walk('/v1/receipts', 'id');
    expect(issued).toHaveLength(3);
    expect(new Set(issued).size).toBe(3);
    expect((await walk('/v1/receipts/eligible', 'orderId')).sort()).toEqual(orders.slice(3).sort());
  });
});
