import { MaintenanceService } from '../src/jobs/maintenance.service';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg } from './helpers';
import { createRaffle, EXE, nextPhone, PDF, PNG, reserve, reserveAndSubmit, storage } from './fixtures';

describe('Órdenes, comprobantes y verificación de pagos', () => {
  let ctx: TestContext;
  let t: TestOrg;
  let verifier: { token: string };
  let seller: { token: string };

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
    verifier = await addMember(ctx, t.org.id, 'payment_verifier');
    seller = await addMember(ctx, t.org.id, 'seller');
  });
  afterAll(() => closeTestApp(ctx));

  const upload = (orderId: string, token: string, contentType: string, size: number) =>
    ctx.http.post(`/v1/public/orders/${orderId}/receipt`).set('X-Order-Token', token).send({ contentType, size });
  const confirm = (orderId: string, token: string, key?: string) =>
    ctx.http.post(`/v1/public/orders/${orderId}/receipt/confirm`).set('X-Order-Token', token).send(key ? { key } : {});

  describe('comprobante', () => {
    it('solo imagen o PDF y máximo 10 MB al pedir la URL firmada', async () => {
      const raffle = await createRaffle(ctx, t);
      const o = (await reserve(ctx, t, raffle.slug, { numbers: [1] })).body;
      const zip = await upload(o.orderId, o.accessToken, 'application/zip', 100).expect(422);
      expect(zip.body).toMatchObject({ code: 'RECEIPT_INVALID_TYPE', message: 'El comprobante debe ser una imagen (JPG, PNG, WEBP o HEIC) o un PDF.' });
      const big = await upload(o.orderId, o.accessToken, 'application/pdf', 11 * 1024 * 1024).expect(422);
      expect(big.body).toMatchObject({ code: 'RECEIPT_TOO_LARGE', message: 'El comprobante supera el máximo de 10 MB.' });
      const ok = await upload(o.orderId, o.accessToken, 'application/pdf', 5000).expect(201);
      expect(ok.body.key).toMatch(new RegExp(`^receipts/${t.org.id}/${o.orderId}/.+\\.pdf$`));
      expect(ok.body.maxBytes).toBe(10 * 1024 * 1024);
      // Subida con PUT (compatible con R2): el tipo y el tamaño declarados quedan en la firma.
      expect(ok.body).toMatchObject({ method: 'PUT', headers: { 'Content-Type': 'application/pdf' } });
      expect(storage(ctx).presigned.at(-1)).toMatchObject({ key: ok.body.key, contentType: 'application/pdf', size: 5000 });
    });

    it('valida el contenido real, no la extensión', async () => {
      const raffle = await createRaffle(ctx, t);
      const o = (await reserve(ctx, t, raffle.slug, { numbers: [2] })).body;
      const up = await upload(o.orderId, o.accessToken, 'image/jpeg', EXE.length).expect(201);
      storage(ctx).put(up.body.key, EXE); // un ejecutable con extensión .jpg
      const bad = await confirm(o.orderId, o.accessToken, up.body.key).expect(422);
      expect(bad.body.code).toBe('RECEIPT_INVALID_TYPE');
      expect(storage(ctx).objects.has(up.body.key)).toBe(false); // se borró

      const big = await upload(o.orderId, o.accessToken, 'image/png', 1000).expect(201);
      storage(ctx).put(big.body.key, Buffer.concat([PNG, Buffer.alloc(10 * 1024 * 1024)]));
      expect((await confirm(o.orderId, o.accessToken, big.body.key).expect(422)).body.code).toBe('RECEIPT_TOO_LARGE');

      const pdf = await upload(o.orderId, o.accessToken, 'application/pdf', PDF.length).expect(201);
      storage(ctx).put(pdf.body.key, PDF);
      const okRes = await confirm(o.orderId, o.accessToken, pdf.body.key).expect(200);
      expect(okRes.body).toMatchObject({ status: 'pending_verification', receiptUploaded: true });
      const stored = await ctx.db.system.order.findUniqueOrThrow({ where: { id: o.orderId } });
      expect(stored.receiptMime).toBe('application/pdf');
    });

    it('no acepta keys de otra orden ni tokens equivocados', async () => {
      const raffle = await createRaffle(ctx, t);
      const a = (await reserve(ctx, t, raffle.slug, { numbers: [3] })).body;
      const b = (await reserve(ctx, t, raffle.slug, { numbers: [4] })).body;
      const up = await upload(a.orderId, a.accessToken, 'image/png', PNG.length).expect(201);
      storage(ctx).put(up.body.key, PNG);
      await confirm(b.orderId, b.accessToken, up.body.key).expect(400);
      await ctx.http.get(`/v1/public/orders/${a.orderId}`).set('X-Order-Token', b.accessToken).expect(404);
      await ctx.http.get(`/v1/public/orders/${a.orderId}`).expect(404);
    });
  });

  describe('vencimiento del apartado', () => {
    it('vence las órdenes sin comprobante; las que ya lo subieron dejan de vencer', async () => {
      const raffle = await createRaffle(ctx, t);
      const plain = (await reserve(ctx, t, raffle.slug, { numbers: [20, 21] })).body;
      const withReceipt = await reserveAndSubmit(ctx, t, raffle.slug, [22]);
      await ctx.db.system.order.updateMany({ where: { id: { in: [plain.orderId, withReceipt.orderId] } }, data: { reservedUntil: new Date(Date.now() - 60_000) } });

      const maintenance = ctx.app.get(MaintenanceService);
      expect(await maintenance.expireReservations()).toBeGreaterThanOrEqual(1);
      expect(await maintenance.expireReservations()).toBe(0); // idempotente

      const orders = await ctx.db.system.order.findMany({ where: { id: { in: [plain.orderId, withReceipt.orderId] } } });
      expect(orders.find((o) => o.id === plain.orderId)?.status).toBe('expired');
      expect(orders.find((o) => o.id === withReceipt.orderId)?.status).toBe('pending_verification');
      const nums = await ctx.db.system.raffleNumber.findMany({ where: { raffleId: raffle.id, number: { in: [20, 21, 22] } }, orderBy: { number: 'asc' } });
      // Los vencidos quedan libres: sin fila (raffle_numbers guarda solo los tomados).
      expect(nums.map((n) => [n.number, n.status])).toEqual([[22, 'pending_verification']]);
      const r = await ctx.db.system.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      expect(r.heldCount).toBe(1);

      // Ya vencida: no se acepta el comprobante y los números se pueden volver a apartar.
      const up = await upload(plain.orderId, plain.accessToken, 'image/png', 10);
      expect(up.status).toBe(409);
      expect(up.body).toMatchObject({ code: 'ORDER_EXPIRED' });
      expect((await reserve(ctx, t, raffle.slug, { numbers: [20] })).status).toBe(201);
    });

    it('si el apartado venció pero el job aún no corrió, tampoco se acepta el comprobante', async () => {
      const raffle = await createRaffle(ctx, t);
      const o = (await reserve(ctx, t, raffle.slug, { numbers: [30] })).body;
      const up = await upload(o.orderId, o.accessToken, 'image/png', PNG.length).expect(201);
      storage(ctx).put(up.body.key, PNG);
      await ctx.db.system.order.update({ where: { id: o.orderId }, data: { reservedUntil: new Date(Date.now() - 1000) } });
      expect((await confirm(o.orderId, o.accessToken, up.body.key).expect(409)).body.code).toBe('ORDER_EXPIRED');
    });

    it('sin «Exigir comprobante» el participante puede reportar el pago sin archivo', async () => {
      const org = await createOrg(ctx);
      const raffle = await createRaffle(ctx, org);
      const o = (await reserve(ctx, org, raffle.slug, { numbers: [1] })).body;
      expect((await confirm(o.orderId, o.accessToken).expect(400)).body.message).toBe('Sube el comprobante de pago para enviarlo a verificación.');
      await ctx.http.put('/v1/settings/payments').set(as(org.ownerToken, org.org.id)).send({ revision: 1, data: { reservationMinutes: 60, requireReceipt: false } }).expect(200);
      const res = await confirm(o.orderId, o.accessToken).expect(200);
      expect(res.body).toMatchObject({ status: 'pending_verification', receiptUploaded: false, requireReceipt: false });
      const o2 = (await reserve(ctx, org, raffle.slug, { numbers: [2] })).body;
      const minutes = (new Date(o2.reservedUntil).getTime() - Date.now()) / 60_000;
      expect(minutes).toBeGreaterThan(59);
      expect(minutes).toBeLessThanOrEqual(60);
    });
  });

  describe('verificación', () => {
    it('cola más antiguos primero, con URL firmada del comprobante', async () => {
      const org = await createOrg(ctx);
      const raffle = await createRaffle(ctx, org);
      const first = await reserveAndSubmit(ctx, org, raffle.slug, [1]);
      const second = await reserveAndSubmit(ctx, org, raffle.slug, [2]);
      await ctx.db.system.order.update({ where: { id: second.orderId }, data: { receiptUploadedAt: new Date(Date.now() - 3_600_000) } });
      const queue = await ctx.http.get('/v1/payments/queue').set(as(org.ownerToken, org.org.id)).expect(200);
      expect(queue.body.map((o: { id: string }) => o.id)).toEqual([second.orderId, first.orderId]);
      expect(queue.body[0].participant.phone).toMatch(/^\+57/);

      const detail = await ctx.http.get(`/v1/orders/${first.orderId}`).set(as(org.ownerToken, org.org.id)).expect(200);
      expect(detail.body.receiptUrl).toContain('expira=60');
    });

    it('aprobar: números pagados, tickets, contadores y auditoría', async () => {
      const raffle = await createRaffle(ctx, t);
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [7, 42]);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(seller.token, t.org.id)).expect(403);
      const res = await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(verifier.token, t.org.id)).expect(200);
      const seq = String(raffle.sequence).padStart(4, '0');
      expect(res.body).toMatchObject({ status: 'approved', statusLabel: 'Pagado' });
      expect(res.body.tickets.map((x: { code: string }) => x.code)).toEqual([`RS-${seq}-07`, `RS-${seq}-42`]);

      const nums = await ctx.db.system.raffleNumber.findMany({ where: { raffleId: raffle.id, number: { in: [7, 42] } } });
      expect(nums.every((n) => n.status === 'paid' && n.paidAt)).toBe(true);
      const r = await ctx.db.system.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      expect([r.paidCount, r.heldCount]).toEqual([2, 0]);
      const audit = await ctx.db.system.auditLog.findFirst({ where: { action: 'order.approve', entityId: o.orderId } });
      expect(audit).toBeTruthy();

      // Aprobar dos veces no duplica nada.
      expect((await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(verifier.token, t.org.id)).expect(409)).body.code).toBe('ORDER_INVALID_STATE');

      const status = await ctx.http.get(`/v1/public/orders/${o.orderId}`).set('X-Order-Token', o.accessToken).expect(200);
      expect(status.body.tickets).toHaveLength(2);
    });

    it('cuando se pagan todos los números el sorteo queda agotado', async () => {
      const raffle = await createRaffle(ctx, t);
      const all = await reserve(ctx, t, raffle.slug, { random: 100 });
      expect(all.status).toBe(201);
      await confirm(all.body.orderId, all.body.accessToken).expect(400);
      await ctx.http.post(`/v1/orders/${all.body.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      const r = await ctx.http.get(`/v1/raffles/${raffle.id}`).set(as(t.ownerToken, t.org.id)).expect(200);
      expect(r.body.status).toBe('sold_out');
      expect(r.body.progress).toEqual({ paid: 100, held: 0, available: 0 });
      expect(r.body.collectedCop).toBe(600_000);
      const sold = await reserve(ctx, t, raffle.slug, { numbers: [1] });
      expect(sold.body).toMatchObject({ code: 'RAFFLE_NOT_ON_SALE', message: 'Este sorteo está agotado.' });

      // Liberar una orden pagada (P9) reabre la venta y anula los tickets.
      await ctx.http.post(`/v1/orders/${all.body.orderId}/release`).set(as(verifier.token, t.org.id)).send({ reason: 'Reembolso' }).expect(403);
      const rel = await ctx.http.post(`/v1/orders/${all.body.orderId}/release`).set(as(t.ownerToken, t.org.id)).send({ reason: 'Reembolso' }).expect(200);
      expect(rel.body).toMatchObject({ status: 'released', tickets: [] });
      const after = await ctx.db.system.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      expect([after.status, after.paidCount]).toEqual(['active', 0]);
      expect(await ctx.db.system.ticket.count({ where: { orderId: all.body.orderId, status: 'void' } })).toBe(100);
    });

    it('rechazar libera los números y guarda el motivo', async () => {
      const raffle = await createRaffle(ctx, t);
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [15]);
      const res = await ctx.http.post(`/v1/orders/${o.orderId}/reject`).set(as(verifier.token, t.org.id)).send({ reason: 'El valor no coincide' }).expect(200);
      expect(res.body).toMatchObject({ status: 'rejected', rejectionReason: 'El valor no coincide' });
      // Libre = sin fila.
      expect(await ctx.db.system.raffleNumber.findUnique({ where: { raffleId_number: { raffleId: raffle.id, number: 15 } } })).toBeNull();
      const pub = await ctx.http.get(`/v1/public/orders/${o.orderId}`).set('X-Order-Token', o.accessToken).expect(200);
      expect(pub.body).toMatchObject({ status: 'rejected', rejectionReason: 'El valor no coincide' });
    });
  });

  describe('cierre de venta (regla 4 y P4)', () => {
    it('a la hora límite: cierra, vence apartados, conserva los que están en verificación', async () => {
      const raffle = await createRaffle(ctx, t);
      const reserved = (await reserve(ctx, t, raffle.slug, { numbers: [50] })).body;
      const pending = await reserveAndSubmit(ctx, t, raffle.slug, [51]);
      await ctx.db.system.raffle.update({ where: { id: raffle.id }, data: { salesCloseAt: new Date(Date.now() - 1000) } });

      const maintenance = ctx.app.get(MaintenanceService);
      expect(await maintenance.closeSalesSweep()).toBeGreaterThanOrEqual(1);
      expect(await maintenance.closeSales(t.org.id, raffle.id)).toBe(false); // idempotente

      const r = await ctx.db.system.raffle.findUniqueOrThrow({ where: { id: raffle.id } });
      expect(r.status).toBe('closed');
      expect((await ctx.db.system.order.findUniqueOrThrow({ where: { id: reserved.orderId } })).status).toBe('expired');
      expect((await reserve(ctx, t, raffle.slug, { numbers: [60] })).body.code).toBe('RAFFLE_NOT_ON_SALE');
      // El pago que llegó antes del cierre todavía se puede aprobar.
      await ctx.http.post(`/v1/orders/${pending.orderId}/approve`).set(as(verifier.token, t.org.id)).expect(200);
      const audit = await ctx.db.system.auditLog.findFirst({ where: { action: 'raffle.close_sales_auto', entityId: raffle.id } });
      expect(audit?.actorType).toBe('system');
    });

    it('cierre manual', async () => {
      const raffle = await createRaffle(ctx, t, { salesCloseAt: null });
      const res = await ctx.http.post(`/v1/raffles/${raffle.id}/close-sales`).set(as(t.ownerToken, t.org.id)).expect(200);
      expect(res.body.status).toBe('closed');
      await ctx.http.post(`/v1/raffles/${raffle.id}/close-sales`).set(as(t.ownerToken, t.org.id)).expect(409);
    });
  });

  describe('participantes y tablero', () => {
    it('lista, detalle, exportación CSV (con permiso) y dashboard', async () => {
      const org = await createOrg(ctx);
      const admin = await addMember(ctx, org.org.id, 'admin');
      const raffle = await createRaffle(ctx, org);
      const phone = nextPhone();
      const o = await reserveAndSubmit(ctx, org, raffle.slug, [8, 9], phone);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(org.ownerToken, org.org.id)).expect(200);
      await reserveAndSubmit(ctx, org, raffle.slug, [10]);

      const list = await ctx.http.get(`/v1/participants?q=${phone.slice(-4)}`).set(as(org.ownerToken, org.org.id)).expect(200);
      expect(list.body.items).toHaveLength(1);
      const detail = await ctx.http.get(`/v1/participants/${list.body.items[0].id}`).set(as(org.ownerToken, org.org.id)).expect(200);
      expect(detail.body.totals).toEqual({ approvedOrders: 1, paidNumbers: 2, paidCop: 12_000 });

      await ctx.http.get('/v1/participants/export.csv').set(as(admin.token, org.org.id)).expect(403);
      const csv = await ctx.http.get('/v1/participants/export.csv').set(as(org.ownerToken, org.org.id)).expect(200);
      expect(csv.headers['content-type']).toContain('text/csv');
      expect(csv.text).toContain('nombre,whatsapp,primer_contacto,ordenes_aprobadas,numeros_pagados,total_pagado_cop');
      expect(csv.text).toContain(`+57${phone}`);
      expect(await ctx.db.system.auditLog.count({ where: { organizationId: org.org.id, action: 'participants.export' } })).toBe(1);

      const dash = await ctx.http.get('/v1/dashboard').set(as(org.ownerToken, org.org.id)).expect(200);
      expect(dash.body).toMatchObject({ weekRevenueCop: 12_000, pendingPayments: 1, activeRaffles: 1 });
      expect(dash.body.nextRaffle.id).toBe(raffle.id);
    });
  });
});
