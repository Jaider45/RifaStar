import { MaintenanceService } from '../src/jobs/maintenance.service';
import { GatewayPaymentsService } from '../src/payments/gateway-payments.service';
import { eventChecksum } from '../src/payments/wompi/signatures';
import { FakeWompiClient, WompiClient } from '../src/payments/wompi/wompi.client';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';
import { createRaffle, reserve } from './fixtures';

const KEYS = {
  publicKey: 'pub_test_AbC123xyz456',
  privateKey: 'prv_test_Secret1234567890',
  integritySecret: 'test_integrity_Abc1234567',
  eventsSecret: 'test_events_Abc1234567',
};

/** Evento «transaction.updated» firmado como lo hace Wompi. */
function signedEvent(tx: { id: string; reference: string; status: string; amount_in_cents: number }, secret = KEYS.eventsSecret, timestamp = Math.floor(Date.now() / 1000)) {
  const event = {
    event: 'transaction.updated',
    data: { transaction: tx },
    environment: 'test',
    signature: { properties: ['transaction.id', 'transaction.status', 'transaction.amount_in_cents'], checksum: '' },
    timestamp,
    sent_at: new Date().toISOString(),
  };
  event.signature.checksum = eventChecksum(event, secret);
  return event;
}

const payBase = { email: 'laura@correo.com', acceptTerms: true, acceptPersonalData: true };
const card = (last4: string) => ({ ...payBase, method: 'CARD', cardToken: `tok_test_${last4}`, installments: 1 });

describe('Pagos en línea de boletas (Wompi detrás del checkout propio)', () => {
  let ctx: TestContext;
  let t: TestOrg;
  let wompi: FakeWompiClient;
  let gateway: GatewayPaymentsService;
  let accountId: string;
  let raffleSlug: string;
  let next = 1;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
    wompi = ctx.app.get(WompiClient) as FakeWompiClient;
    gateway = ctx.app.get(GatewayPaymentsService);
    raffleSlug = (await createRaffle(ctx, t)).slug;
  });
  afterAll(() => closeTestApp(ctx));

  /** Aparta un número libre distinto en cada llamada. */
  const newOrder = async (org = t, slug = raffleSlug) => {
    const res = await reserve(ctx, org, slug, { numbers: [next++] });
    expect(res.status).toBe(201);
    return res.body as { orderId: string; accessToken: string };
  };
  /** Cada llamada sale de una IP distinta: así los límites por IP no mezclan unas pruebas con otras. */
  const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const pay = (o: { orderId: string; accessToken: string }, body: object) =>
    ctx.http.post(`/v1/public/orders/${o.orderId}/pay`).set('X-Order-Token', o.accessToken).set('X-Forwarded-For', ip()).send(body);
  const status = (o: { orderId: string; accessToken: string }) =>
    ctx.http.get(`/v1/public/orders/${o.orderId}/payment`).set('X-Order-Token', o.accessToken);
  const orderRow = (id: string) => ctx.db.system.order.findUniqueOrThrow({ where: { id } });
  const paymentRow = (id: string) => ctx.db.system.gatewayPayment.findFirstOrThrow({ where: { orderId: id }, orderBy: { createdAt: 'desc' } });

  it('sin cuenta conectada el checkout dice que no hay pago en línea', async () => {
    const o = await newOrder();
    const res = await ctx.http.get(`/v1/public/orders/${o.orderId}/checkout`).set('X-Order-Token', o.accessToken).expect(200);
    expect(res.body).toMatchObject({ enabled: false });
    const info = await ctx.http.get(`/v1/public/orders/${o.orderId}`).set('X-Order-Token', o.accessToken).expect(200);
    expect(info.body.online).toEqual({ enabled: false });
    expect((await pay(o, card('4242'))).status).toBe(409);
  });

  it('conectar la cuenta: valida los prefijos, cifra las llaves y no las devuelve', async () => {
    const mixed = await ctx.http.put('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send({ ...KEYS, integritySecret: 'prod_integrity_Abc1234567' }).expect(400);
    expect(mixed.body.message).toContain('usa las cuatro del mismo ambiente');
    const wrong = await ctx.http.put('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send({ ...KEYS, publicKey: 'llave-cualquiera' }).expect(400);
    expect(wrong.body.message).toContain('pub_test_');

    const seller = await addMember(ctx, t.org.id, 'seller', { sellerCode: 'VEN1' });
    await ctx.http.put('/v1/payments/gateway').set(as(seller.token, t.org.id)).send(KEYS).expect(403);

    const ok = await ctx.http.put('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send(KEYS).expect(200);
    accountId = ok.body.id;
    expect(ok.body).toMatchObject({ configured: true, environment: 'sandbox', isActive: true, publicKey: KEYS.publicKey });
    expect(ok.body.webhookUrl).toMatch(new RegExp(`/v1/webhooks/wompi/${accountId}$`));
    expect(ok.body.methods).toEqual(['CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER']);

    // Nada secreto sale por la API ni se guarda en claro.
    const again = await ctx.http.get('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).expect(200);
    for (const secret of [KEYS.privateKey, KEYS.integritySecret, KEYS.eventsSecret]) expect(JSON.stringify(again.body)).not.toContain(secret);
    expect(again.body.privateKeyHint).toMatch(/••••7890$/);
    const stored = await ctx.db.system.gatewayAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(stored.privateKeyEnc).not.toContain(KEYS.privateKey);
    expect(ctx.app.get(WompiClient)).toBeInstanceOf(FakeWompiClient);

    // Otra organización no ve esta cuenta.
    const other = await createOrg(ctx);
    const theirs = await ctx.http.get('/v1/payments/gateway').set(as(other.ownerToken, other.org.id)).expect(200);
    expect(theirs.body.configured).toBe(false);
  });

  it('tarjeta aprobada: queda en curso, se confirma al consultar y la orden se aprueba con sus boletos', async () => {
    const o = await newOrder();
    const co = await ctx.http.get(`/v1/public/orders/${o.orderId}/checkout`).set('X-Order-Token', o.accessToken).expect(200);
    expect(co.body).toMatchObject({ enabled: true, environment: 'sandbox', publicKey: KEYS.publicKey, amountCop: 6000 });
    expect(co.body.contracts.terms).toMatch(/^https:\/\//);
    expect(JSON.stringify(co.body)).not.toContain(KEYS.privateKey);

    const res = await pay(o, card('4242')).expect(200);
    expect(res.body).toMatchObject({ status: 'pending', method: 'CARD', amountCop: 6000, final: false });
    expect((await orderRow(o.orderId)).status).toBe('reserved'); // aún no: falta la confirmación de Wompi

    const done = await status(o).expect(200);
    expect(done.body.payment).toMatchObject({ status: 'approved', final: true });
    expect((await orderRow(o.orderId)).status).toBe('approved');
    expect(await ctx.db.system.ticket.count({ where: { orderId: o.orderId, status: 'valid' } })).toBe(1);

    // La referencia enviada a Wompi es el id del pago y el monto va en centavos.
    const row = await paymentRow(o.orderId);
    const sent = wompi.transactions.get(row.externalId!)!.body;
    expect(sent).toMatchObject({ reference: row.id, amount_in_cents: 600_000, currency: 'COP' });
    expect(sent.signature).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(sent)).not.toContain(KEYS.integritySecret);

    // Pagar otra vez una orden pagada no cobra de nuevo.
    expect((await pay(o, card('4242'))).status).toBe(409);
    expect(await ctx.db.system.gatewayPayment.count({ where: { orderId: o.orderId } })).toBe(1);
  });

  it('tarjeta rechazada: la orden sigue apartada y se puede reintentar con otra', async () => {
    const o = await newOrder();
    await pay(o, card('1111')).expect(200);
    const declined = await status(o).expect(200);
    expect(declined.body.payment).toMatchObject({ status: 'declined', final: true });
    expect((await orderRow(o.orderId)).status).toBe('reserved');

    await pay(o, card('4242')).expect(200);
    expect((await status(o)).body.payment.status).toBe('approved');
    expect((await orderRow(o.orderId)).status).toBe('approved');
    expect(await ctx.db.system.gatewayPayment.count({ where: { orderId: o.orderId } })).toBe(2);
  });

  it('dos clics a la vez no cobran dos veces', async () => {
    const o = await newOrder();
    const [a, b] = await Promise.all([pay(o, card('4242')), pay(o, card('4242'))]);
    // Uno crea el cobro; el otro ve el pago del primero (200) o llega cuando ya está aprobada (409): nunca dos cobros.
    expect([a.status, b.status]).toContain(200);
    expect([a.status, b.status].every((c) => c === 200 || c === 409)).toBe(true);
    await status(o);
    expect(await ctx.db.system.gatewayPayment.count({ where: { orderId: o.orderId, status: 'approved' } })).toBe(1);
    expect(await ctx.db.system.ticket.count({ where: { orderId: o.orderId, status: 'valid' } })).toBe(1);
    expect((await orderRow(o.orderId)).status).toBe('approved');
  });

  it('valida los datos de cada medio y que se acepten los contratos', async () => {
    const o = await newOrder();
    expect((await pay(o, { ...card('4242'), acceptTerms: false })).status).toBe(400);
    expect((await pay(o, { ...payBase, method: 'CARD' })).status).toBe(400);
    expect((await pay(o, { ...payBase, method: 'NEQUI', phone: '12345' })).status).toBe(400);
    expect((await pay(o, { ...payBase, method: 'PSE' })).status).toBe(400);
    expect((await pay(o, { ...payBase, method: 'EFECTY' })).status).toBe(400);
    expect(await ctx.db.system.gatewayPayment.count({ where: { orderId: o.orderId } })).toBe(0);

    await ctx.http.patch('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send({ methods: ['CARD'] }).expect(200);
    expect((await pay(o, { ...payBase, method: 'NEQUI', phone: '3991111111' })).status).toBe(400);
    await ctx.http.patch('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send({ methods: ['CARD', 'NEQUI', 'PSE', 'BANCOLOMBIA_TRANSFER'] }).expect(200);
  });

  it('Nequi, PSE y Bancolombia: aprueban y rechazan como en el sandbox', async () => {
    const nequi = await newOrder();
    await pay(nequi, { ...payBase, method: 'NEQUI', phone: '3991111111' }).expect(200);
    expect((await status(nequi)).body.payment.status).toBe('approved');

    const nequiNo = await newOrder();
    await pay(nequiNo, { ...payBase, method: 'NEQUI', phone: '3992222222' }).expect(200);
    expect((await status(nequiNo)).body.payment.status).toBe('declined');

    const banks = await ctx.http.get(`/v1/public/orders/${nequiNo.orderId}/checkout/banks`).set('X-Order-Token', nequiNo.accessToken).expect(200);
    expect(banks.body.map((b: { code: string }) => b.code)).toEqual(['1', '2']);

    const pse = await newOrder();
    const pseRes = await pay(pse, { ...payBase, method: 'PSE', pse: { userType: 0, legalIdType: 'CC', legalId: '1234567890', bankCode: '1' } }).expect(200);
    expect(pseRes.body.redirectUrl).toMatch(/^https:\/\//); // el banco: el participante sale un momento de la página
    const sent = wompi.transactions.get((await paymentRow(pse.orderId)).externalId!)!.body.payment_method as Record<string, unknown>;
    expect(sent).toMatchObject({ type: 'PSE', user_type: 0, user_legal_id_type: 'CC', financial_institution_code: '1' });
    expect((await status(pse)).body.payment.status).toBe('approved');

    const bc = await newOrder();
    const bcRes = await pay(bc, { ...payBase, method: 'BANCOLOMBIA_TRANSFER' }).expect(200);
    expect(bcRes.body.redirectUrl).toBeTruthy();
    expect((await status(bc)).body.payment.status).toBe('approved');
  });

  it('con un pago en curso la orden no vence aunque pase la hora del apartado', async () => {
    const o = await newOrder();
    await pay(o, { ...payBase, method: 'PSE', pse: { userType: 0, legalIdType: 'CC', legalId: '1234567890', bankCode: '1' } }).expect(200);
    await ctx.db.system.order.update({ where: { id: o.orderId }, data: { reservedUntil: new Date(Date.now() - 60_000) } });

    await ctx.app.get(MaintenanceService).expireReservations();
    expect((await orderRow(o.orderId)).status).toBe('reserved');

    // Cuando el banco confirma, se aprueba aunque la hora del apartado ya pasó.
    expect((await status(o)).body.payment.status).toBe('approved');
    expect((await orderRow(o.orderId)).status).toBe('approved');
  });

  it('con un pago en línea en curso no se recibe comprobante de transferencia (no se cobra dos veces)', async () => {
    const o = await newOrder();
    await pay(o, { ...payBase, method: 'PSE', pse: { userType: 0, legalIdType: 'CC', legalId: '1234567890', bankCode: '1' } }).expect(200);
    const receipt = (path: string, body: object) =>
      ctx.http.post(`/v1/public/orders/${o.orderId}/${path}`).set('X-Order-Token', o.accessToken).set('X-Forwarded-For', ip()).send(body);

    const upload = await receipt('receipt', { contentType: 'image/png', size: 1000 }).expect(409);
    expect(upload.body.code).toBe('ONLINE_PAYMENT_IN_PROGRESS');
    const confirm = await receipt('receipt/confirm', {}).expect(409);
    expect(confirm.body.code).toBe('ONLINE_PAYMENT_IN_PROGRESS');
    expect((await orderRow(o.orderId)).status).toBe('reserved');

    // Cuando el pago en línea se aprueba, la orden queda pagada una sola vez y ya no admite comprobante.
    expect((await status(o)).body.payment.status).toBe('approved');
    expect((await orderRow(o.orderId)).status).toBe('approved');
    expect((await receipt('receipt/confirm', {})).status).toBe(409);
  });

  it('webhook: firma inválida → 401; evento repetido no se procesa dos veces; referencia desconocida se ignora', async () => {
    const o = await newOrder();
    await pay(o, { ...payBase, method: 'NEQUI', phone: '3991111111' }).expect(200);
    const row = await paymentRow(o.orderId);
    const tx = { id: row.externalId!, reference: row.id, status: 'APPROVED', amount_in_cents: 600_000 };
    wompi.settle(row.externalId!, 'APPROVED');

    const forged = signedEvent(tx, 'test_events_OtroSecreto123');
    await ctx.http.post(`/v1/webhooks/wompi/${accountId}`).send(forged).expect(401);
    expect((await orderRow(o.orderId)).status).toBe('reserved');
    await ctx.http.post(`/v1/webhooks/wompi/${accountId}`).send({ ...signedEvent(tx), signature: { properties: [], checksum: 'ABC' } }).expect(401);

    // Otra organización con su propio secreto no puede mandar eventos a esta cuenta.
    const event = signedEvent(tx);
    const first = await ctx.http.post(`/v1/webhooks/wompi/${accountId}`).send(event);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body).toMatchObject({ received: true, duplicate: false });
    expect((await orderRow(o.orderId)).status).toBe('approved');
    const again = await ctx.http.post(`/v1/webhooks/wompi/${accountId}`).send(event).expect(200);
    expect(again.body.duplicate).toBe(true);
    expect(await ctx.db.system.ticket.count({ where: { orderId: o.orderId, status: 'valid' } })).toBe(1);

    const stranger = signedEvent({ id: 'tx-x', reference: '00000000-0000-4000-8000-000000000000', status: 'APPROVED', amount_in_cents: 600_000 });
    expect((await ctx.http.post(`/v1/webhooks/wompi/${accountId}`).send(stranger).expect(200)).body.received).toBe(true);
    const stored = await ctx.db.system.gatewayEvent.findFirstOrThrow({ where: { externalEventId: stranger.signature.checksum.toUpperCase() } });
    expect(stored.lastError).toBe('Referencia desconocida');
    expect((await ctx.db.system.gatewayAccount.findUniqueOrThrow({ where: { id: accountId } })).lastEventAt).not.toBeNull();
  });

  it('un evento de otra organización no aprueba la orden de esta (la referencia es del pago)', async () => {
    const other = await createOrg(ctx);
    const otherSlug = (await createRaffle(ctx, other)).slug;
    const theirKeys = { ...KEYS, eventsSecret: 'test_events_OtraOrg123456' };
    const theirs = await ctx.http.put('/v1/payments/gateway').set(as(other.ownerToken, other.org.id)).send(theirKeys).expect(200);

    const mine = await newOrder();
    await pay(mine, { ...payBase, method: 'NEQUI', phone: '3991111111' }).expect(200);
    const row = await paymentRow(mine.orderId);
    wompi.settle(row.externalId!, 'APPROVED');
    // Evento correctamente firmado por la OTRA organización, pero con la referencia de un pago mío.
    const evt = signedEvent({ id: row.externalId!, reference: row.id, status: 'APPROVED', amount_in_cents: 600_000 }, theirKeys.eventsSecret);
    await ctx.http.post(`/v1/webhooks/wompi/${theirs.body.id}`).send(evt).expect(200);
    expect((await orderRow(mine.orderId)).status).toBe('reserved');
    expect(otherSlug).toBeTruthy();
  });

  it('monto distinto al de la orden: no se aprueba y queda marcado para revisar', async () => {
    const o = await newOrder();
    await pay(o, card('4242')).expect(200);
    const row = await paymentRow(o.orderId);
    wompi.transactions.get(row.externalId!)!.tx.amountInCents = 100;
    await status(o).expect(200);
    const after = await paymentRow(o.orderId);
    expect(after).toMatchObject({ status: 'error', refundRequired: true });
    expect((await orderRow(o.orderId)).status).toBe('reserved');
  });

  it('pago aprobado después de que la orden venció: retoma los números si siguen libres', async () => {
    const o = await newOrder();
    await pay(o, { ...payBase, method: 'PSE', pse: { userType: 0, legalIdType: 'CC', legalId: '1234567890', bankCode: '1' } }).expect(200);
    const number = (await orderRow(o.orderId)).numbers[0];
    // Pasó el tope de 60 min: la orden vence y se liberan los números.
    await ctx.db.system.gatewayPayment.updateMany({ where: { orderId: o.orderId }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    await ctx.db.system.order.update({ where: { id: o.orderId }, data: { reservedUntil: new Date(Date.now() - 3_600_000) } });
    await ctx.app.get(MaintenanceService).expireReservations();
    expect((await orderRow(o.orderId)).status).toBe('expired');

    expect((await status(o)).body.payment.status).toBe('approved');
    expect((await orderRow(o.orderId)).status).toBe('approved');
    expect(await ctx.db.system.raffleNumber.count({ where: { orderId: o.orderId, status: 'paid' } })).toBe(1);
    expect(await ctx.db.system.ticket.count({ where: { orderId: o.orderId, number } })).toBe(1);
  });

  it('pago aprobado cuando otra persona ya compró el número: queda para reembolso, nunca se pierde', async () => {
    const o = await newOrder();
    await pay(o, { ...payBase, method: 'PSE', pse: { userType: 0, legalIdType: 'CC', legalId: '1234567890', bankCode: '1' } }).expect(200);
    const number = (await orderRow(o.orderId)).numbers[0];
    await ctx.db.system.gatewayPayment.updateMany({ where: { orderId: o.orderId }, data: { createdAt: new Date(Date.now() - 2 * 3_600_000) } });
    await ctx.db.system.order.update({ where: { id: o.orderId }, data: { reservedUntil: new Date(Date.now() - 3_600_000) } });
    await ctx.app.get(MaintenanceService).expireReservations();
    // Otra persona se queda con el número.
    const taken = await reserve(ctx, t, raffleSlug, { numbers: [number] });
    expect(taken.status).toBe(201);

    expect((await status(o)).body.payment.status).toBe('approved');
    const row = await paymentRow(o.orderId);
    expect(row.refundRequired).toBe(true);
    expect(row.statusMessage).toContain('otra persona compró');
    expect((await orderRow(o.orderId)).status).toBe('expired');
    expect(await ctx.db.system.ticket.count({ where: { orderId: o.orderId } })).toBe(0);
    expect(await ctx.db.system.auditLog.count({ where: { action: 'gateway.refund_required', entityId: row.id } })).toBe(1);

    // El organizador lo ve en su panel y lo marca como reembolsado.
    const list = await ctx.http.get('/v1/payments/gateway/transactions?refundRequired=true').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(list.body.refundsPending).toBeGreaterThanOrEqual(1);
    expect(list.body.items.find((i: { id: string }) => i.id === row.id)).toMatchObject({ refundRequired: true, amountCop: 6000 });
    await ctx.http.post(`/v1/payments/gateway/transactions/${row.id}/refunded`).set(as(t.ownerToken, t.org.id)).send({ note: 'x' }).expect(400);
    await ctx.http.post(`/v1/payments/gateway/transactions/${row.id}/refunded`).set(as(t.ownerToken, t.org.id)).send({ note: 'Reembolsado desde Wompi' }).expect(200);
    expect((await paymentRow(o.orderId)).refundRequired).toBe(false);
  });

  it('la conciliación resuelve los pagos cuyo webhook se perdió', async () => {
    const o = await newOrder();
    await pay(o, card('4242')).expect(200);
    const row = await paymentRow(o.orderId);
    await ctx.db.system.gatewayPayment.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 5 * 60_000) } });
    expect(await gateway.reconcile()).toBeGreaterThanOrEqual(1);
    expect((await orderRow(o.orderId)).status).toBe('approved');
  });

  it('un pago que Wompi nunca resuelve se da por fallido a las 24 h', async () => {
    const o = await newOrder();
    await pay(o, { ...payBase, method: 'PSE', pse: { userType: 0, legalIdType: 'CC', legalId: '1234567890', bankCode: '9' } }).expect(200);
    const row = await paymentRow(o.orderId);
    // Wompi lo deja en curso para siempre.
    wompi.transactions.get(row.externalId!)!.outcome = 'PENDING';
    await ctx.db.system.gatewayPayment.update({ where: { id: row.id }, data: { createdAt: new Date(Date.now() - 25 * 3_600_000) } });
    await gateway.reconcile();
    expect(await paymentRow(o.orderId)).toMatchObject({ status: 'error', refundRequired: false });
  });

  it('desactivar la cuenta apaga el pago en línea', async () => {
    const o = await newOrder();
    await ctx.http.patch('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send({ isActive: false }).expect(200);
    expect((await ctx.http.get(`/v1/public/orders/${o.orderId}/checkout`).set('X-Order-Token', o.accessToken)).body.enabled).toBe(false);
    expect((await pay(o, card('4242'))).status).toBe(409);
    await ctx.http.patch('/v1/payments/gateway').set(as(t.ownerToken, t.org.id)).send({ isActive: true }).expect(200);
  });
});
