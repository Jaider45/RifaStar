import { createHmac } from 'node:crypto';
import { MessagingProvider, FakeMessagingProvider } from '../src/messaging/messaging.provider';
import { MessagesService } from '../src/messaging/messages.service';
import { MessagesWorker } from '../src/messaging/messages.worker';
import { NotificationsService } from '../src/messaging/notifications.service';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { RedisService } from '../src/redis/redis.service';
import { RankingService } from '../src/ranking/ranking.service';
import { localMonthKey } from '../src/common/time';
import { as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg, totp } from './helpers';
import { createRaffle, nextPhone, reserveAndSubmit } from './fixtures';

describe('WhatsApp y colas', () => {
  let ctx: TestContext;
  let fake: FakeMessagingProvider;
  let messages: MessagesService;
  let notifications: NotificationsService;

  beforeAll(async () => {
    ctx = await createTestApp();
    fake = ctx.app.get(MessagingProvider) as FakeMessagingProvider;
    messages = ctx.app.get(MessagesService);
    notifications = ctx.app.get(NotificationsService);
  });
  afterAll(() => closeTestApp(ctx));
  beforeEach(() => fake.reset());

  /** Procesa (como el worker) los mensajes en cola de una org. */
  async function drain(orgId: string) {
    const queued = await ctx.db.system.messageLog.findMany({ where: { organizationId: orgId, status: 'queued' }, orderBy: { createdAt: 'asc' } });
    for (const m of queued) await messages.process(m.id).catch(() => undefined);
    return queued.length;
  }
  const logs = (orgId: string, template?: string) =>
    ctx.db.system.messageLog.findMany({ where: { organizationId: orgId, ...(template && { template }) }, orderBy: { createdAt: 'asc' } });

  async function setNotifications(t: TestOrg, data: object) {
    const cur = await ctx.http.get('/v1/settings/notifications').set(as(t.ownerToken, t.org.id)).expect(200);
    await ctx.http.put('/v1/settings/notifications').set(as(t.ownerToken, t.org.id)).send({ revision: cur.body.revision, data: { ...cur.body.data, ...data } }).expect(200);
  }

  it('al aprobar se encola el boleto (después del commit) y se envía una sola vez', async () => {
    const t = await createOrg(ctx);
    const raffle = await createRaffle(ctx, t);
    const phone = nextPhone();
    const o = await reserveAndSubmit(ctx, t, raffle.slug, [7, 42], phone);
    await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);

    const [log] = await logs(t.org.id, 'ticket_confirmed');
    expect(log).toMatchObject({ status: 'queued', toPhone: `+57${phone}`, idempotencyKey: `ticket:${o.orderId}` });
    expect(await ctx.app.get(SchedulerService).messages.getJob(log.id)).toBeTruthy();

    expect(await messages.process(log.id)).toBe('sent');
    expect(await messages.process(log.id)).toBe('skipped'); // idempotente
    const sent = fake.to(`+57${phone}`);
    expect(sent).toHaveLength(1);
    expect(sent[0].template).toBe('rs_ticket_confirmed');
    expect(sent[0].preview).toMatch(/Números: 07 y 42\. Boletos: RS-\d{4}-07, RS-\d{4}-42/);
    const after = await ctx.db.system.messageLog.findUniqueOrThrow({ where: { id: log.id } });
    expect(after).toMatchObject({ status: 'sent', attempts: 1 });
    expect(after.providerMessageId).toMatch(/^wamid\./);

    // Volver a encolar con la misma clave no crea otro mensaje.
    expect(await messages.enqueue(t.org.id, 'payment_rejected', `+57${phone}`, { name: 'x', raffle: 'y', reason: 'z' }, { idempotencyKey: `ticket:${o.orderId}` })).toBeNull();
    const usage = await ctx.db.system.usageCounter.findFirstOrThrow({ where: { organizationId: t.org.id } });
    expect(usage.used).toBe(1);
  });

  it('rechazo: avisa con el motivo; con «Confirmación de compra» apagada no se envía el boleto', async () => {
    const t = await createOrg(ctx);
    await setNotifications(t, { purchaseConfirmation: false });
    const raffle = await createRaffle(ctx, t);
    const a = await reserveAndSubmit(ctx, t, raffle.slug, [1]);
    const b = await reserveAndSubmit(ctx, t, raffle.slug, [2]);
    await ctx.http.post(`/v1/orders/${a.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    await ctx.http.post(`/v1/orders/${b.orderId}/reject`).set(as(t.ownerToken, t.org.id)).send({ reason: 'El valor no coincide' }).expect(200);
    await drain(t.org.id);
    expect((await logs(t.org.id)).map((l) => l.template)).toEqual(['payment_rejected']);
    expect(fake.sent[0].preview).toContain('El valor no coincide');
  });

  describe('reintentos y fallas (worker BullMQ real)', () => {
    let worker: MessagesWorker;
    beforeAll(() => {
      worker = new MessagesWorker(ctx.app.get(RedisService), messages);
      worker.onModuleInit();
    });
    afterAll(() => worker.onModuleDestroy());

    const waitFor = async (id: string, status: string) => {
      for (let i = 0; i < 100; i++) {
        const m = await ctx.db.system.messageLog.findUniqueOrThrow({ where: { id } });
        if (m.status === status) return m;
        await new Promise((r) => setTimeout(r, 100));
      }
      throw new Error(`El mensaje no llegó a ${status}`);
    };

    it('errores transitorios: reintento exponencial hasta enviarse', async () => {
      const t = await createOrg(ctx);
      fake.failNext(2);
      const id = await messages.enqueue(t.org.id, 'otp_code', '+573001112233', { code: '123456', org: 'X' }, { idempotencyKey: `t-retry-${t.org.id}` });
      const m = await waitFor(id!, 'sent');
      expect(m.attempts).toBe(3);
      expect(m.error).toBeNull();
    });

    it('error definitivo: queda fallido y devuelve la cuota', async () => {
      const t = await createOrg(ctx);
      fake.failNext(1, true);
      const id = await messages.enqueue(t.org.id, 'otp_code', '+573001112244', { code: '123456', org: 'X' }, { idempotencyKey: `t-perm-${t.org.id}` });
      const m = await waitFor(id!, 'failed');
      expect(m.error).toBe('Falla simulada');
      const usage = await ctx.db.system.usageCounter.findFirstOrThrow({ where: { organizationId: t.org.id } });
      expect(usage.used).toBe(0);
    });
  });

  describe('cuota y plan (P6)', () => {
    it('plan sin automatización: solo se envían los códigos OTP', async () => {
      const t = await createOrg(ctx, { planCode: 'basico' });
      expect(await messages.enqueue(t.org.id, 'ticket_confirmed', '+573001110000', { name: 'a', raffle: 'b', numbers: '1', codes: 'c', drawAt: 'd' }, { idempotencyKey: `b-${t.org.id}` })).toBeNull();
      expect(await messages.enqueue(t.org.id, 'otp_code', '+573001110000', { code: '111111', org: 'b' }, { idempotencyKey: `b-otp-${t.org.id}` })).not.toBeNull();
    });

    it('cuota agotada: promocionales se omiten, transaccionales salen; «avisar» responde 402', async () => {
      const t = await createOrg(ctx, { planCode: 'pro' });
      const period = localMonthKey(new Date(), 'America/Bogota');
      await ctx.db.system.usageCounter.create({ data: { organizationId: t.org.id, metric: 'whatsapp_messages', period, used: 2000 } });
      const promo = await messages.enqueue(t.org.id, 'draw_reminder', '+573001110001', { name: 'a', raffle: 'b', time: 'c', numbers: '1' }, { idempotencyKey: `q1-${t.org.id}` });
      const trans = await messages.enqueue(t.org.id, 'payment_rejected', '+573001110001', { name: 'a', raffle: 'b', reason: 'c' }, { idempotencyKey: `q2-${t.org.id}` });
      expect(await messages.process(promo!)).toBe('skipped_quota');
      expect(await messages.process(trans!)).toBe('sent');
      expect((await ctx.db.system.messageLog.findUniqueOrThrow({ where: { id: promo! } })).status).toBe('skipped_quota');
      expect((await ctx.db.system.usageCounter.findFirstOrThrow({ where: { organizationId: t.org.id } })).used).toBe(2001);

      const raffle = await createRaffle(ctx, t);
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [35]);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      await ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: totp(), mainResult: '2435', anticipatedResult: '0000' }).expect(200);
      await ctx.http.post(`/v1/raffles/${raffle.id}/results/publish`).set(as(t.ownerToken, t.org.id)).expect(200);
      const res = await ctx.http.post(`/v1/raffles/${raffle.id}/results/notify`).set(as(t.ownerToken, t.org.id)).expect(402);
      expect(res.body.code).toBe('PLAN_QUOTA_WHATSAPP');
      expect(res.body.message).toMatch(/No te alcanzan los mensajes del mes/);
    });
  });

  describe('webhook de WhatsApp', () => {
    const sign = (body: string) => `sha256=${createHmac('sha256', 'test-whatsapp-app-secret').update(body).digest('hex')}`;

    it('verificación de alta y firma obligatoria', async () => {
      const ok = await ctx.http.get('/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=test-verify-token&hub.challenge=42').expect(200);
      expect(ok.text).toBe('42');
      await ctx.http.get('/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=42').expect(403);
      const res = await ctx.http.post('/v1/webhooks/whatsapp').set('X-Hub-Signature-256', 'sha256=deadbeef').send({ entry: [] }).expect(401);
      expect(res.body.code).toBe('WEBHOOK_SIGNATURE_INVALID');
    });

    it('actualiza el estado de entrega (solo avanza)', async () => {
      const t = await createOrg(ctx);
      const id = await messages.enqueue(t.org.id, 'otp_code', '+573001110002', { code: '222222', org: 'X' }, { idempotencyKey: `wh-${t.org.id}` });
      await messages.process(id!);
      const m = await ctx.db.system.messageLog.findUniqueOrThrow({ where: { id: id! } });
      const payload = (status: string) =>
        JSON.stringify({ entry: [{ changes: [{ value: { statuses: [{ id: m.providerMessageId, status, timestamp: '1761400000' }] } }] }] });
      for (const status of ['read', 'delivered']) {
        const body = payload(status);
        await ctx.http.post('/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('X-Hub-Signature-256', sign(body)).send(body).expect(200);
      }
      const after = await ctx.db.system.messageLog.findUniqueOrThrow({ where: { id: id! } });
      expect(after.status).toBe('read');
      expect(after.readAt).toEqual(new Date(1761400000 * 1000));
    });
  });

  describe('«Mis boletos» con OTP', () => {
    it('nunca muestra boletos solo con el teléfono', async () => {
      const t = await createOrg(ctx);
      const raffle = await createRaffle(ctx, t);
      const phone = nextPhone();
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [7, 13], phone);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      await reserveAndSubmit(ctx, t, raffle.slug, [31], phone);

      const base = `/v1/public/orgs/${t.org.slug}/my-tickets`;
      await ctx.http.get(base).expect(401);

      // Teléfono sin compras: misma respuesta, sin mensaje.
      const unknown = await ctx.http.post(`${base}/otp`).send({ phone: nextPhone() }).expect(202);
      expect(unknown.body.message).toBe('Si tienes boletos con ese número, te enviamos un código por WhatsApp.');

      await ctx.http.post(`${base}/otp`).send({ phone }).expect(202);
      const again = await ctx.http.post(`${base}/otp`).send({ phone }).expect(429);
      expect(again.body.code).toBe('RATE_LIMITED');

      const [otpLog] = await logs(t.org.id, 'otp_code');
      expect(otpLog.toPhone).toBe(`+57${phone}`);
      const code = (otpLog.variables as { code: string }).code;
      expect(code).toMatch(/^\d{6}$/);

      const wrong = code === '000000' ? '111111' : '000000';
      const bad = await ctx.http.post(`${base}/verify`).send({ phone, code: wrong }).expect(401);
      expect(bad.body).toMatchObject({ code: 'OTP_INVALID' });

      const ok = await ctx.http.post(`${base}/verify`).send({ phone, code }).expect(200);
      expect(ok.body.expiresIn).toBe(1800);
      // El código es de un solo uso.
      await ctx.http.post(`${base}/verify`).send({ phone, code }).expect(401);

      const view = await ctx.http.get(base).set('Authorization', `Bearer ${ok.body.token}`).expect(200);
      expect(view.body.participant.referralCode).toMatch(/^[0-9A-F]{8}$/);
      expect(view.body.raffles[0].tickets.map((x: { number: string }) => x.number)).toEqual(['07', '13']);
      expect(view.body.raffles[0].pending).toMatchObject([{ status: 'pending_verification', numbers: ['31'] }]);

      // El token no sirve en otra organización ni como sesión del panel.
      const other = await createOrg(ctx);
      await ctx.http.get(`/v1/public/orgs/${other.org.slug}/my-tickets`).set('Authorization', `Bearer ${ok.body.token}`).expect(401);
      await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${ok.body.token}`).expect(401);
    });

    it('bloquea el código después de 5 intentos fallidos', async () => {
      const t = await createOrg(ctx);
      const raffle = await createRaffle(ctx, t);
      const phone = nextPhone();
      await reserveAndSubmit(ctx, t, raffle.slug, [5], phone);
      const base = `/v1/public/orgs/${t.org.slug}/my-tickets`;
      await ctx.http.post(`${base}/otp`).send({ phone }).expect(202);
      const code = ((await logs(t.org.id, 'otp_code'))[0].variables as { code: string }).code;
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) await ctx.http.post(`${base}/verify`).send({ phone, code: wrong }).expect(401);
      const locked = await ctx.http.post(`${base}/verify`).send({ phone, code }).expect(429);
      expect(locked.body.code).toBe('OTP_LOCKED');
    });
  });

  describe('avisos automáticos', () => {
    it('recordatorio 2 h antes a quienes pagaron (job programado e idempotente)', async () => {
      const t = await createOrg(ctx);
      const raffle = await createRaffle(ctx, t);
      const paidPhone = nextPhone();
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [8], paidPhone);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      await reserveAndSubmit(ctx, t, raffle.slug, [9]); // sin pagar: no recibe

      const jobId = SchedulerService.drawReminderJobId(raffle.id, new Date(raffle.drawAt));
      const job = await ctx.app.get(SchedulerService).maintenance.getJob(jobId);
      expect(job).toBeTruthy();
      expect(job!.opts.delay).toBeGreaterThan(45 * 3_600_000);

      expect(await notifications.drawReminder(t.org.id, raffle.id, '2020-01-01T00:00:00.000Z')).toBe(0); // job viejo
      expect(await notifications.drawReminder(t.org.id, raffle.id, raffle.drawAt)).toBe(1);
      expect(await notifications.drawReminder(t.org.id, raffle.id, raffle.drawAt)).toBe(0);
      expect((await logs(t.org.id, 'draw_reminder'))[0].toPhone).toBe(`+57${paidPhone}`);

      await setNotifications(t, { drawReminder: false });
      const r2 = await createRaffle(ctx, t);
      const o2 = await reserveAndSubmit(ctx, t, r2.slug, [1]);
      await ctx.http.post(`/v1/orders/${o2.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      expect(await notifications.drawReminder(t.org.id, r2.id, r2.drawAt)).toBe(0);
    });

    it('«Avísame» al publicar y aviso de cancelación a quienes pagaron', async () => {
      const t = await createOrg(ctx);
      await setNotifications(t, { newRaffleNotice: true });
      const subscriber = nextPhone();
      await ctx.http.post(`/v1/public/orgs/${t.org.slug}/notify-me`).send({ name: 'Marta López', phone: subscriber }).expect(200);
      const raffle = await createRaffle(ctx, t);
      const [notice] = await logs(t.org.id, 'new_raffle');
      expect(notice.toPhone).toBe(`+57${subscriber}`);
      expect((notice.variables as { link: string }).link).toContain(`/${t.org.slug}/${raffle.slug}`);

      const o = await reserveAndSubmit(ctx, t, raffle.slug, [3]);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      await ctx.http.post(`/v1/raffles/${raffle.id}/cancel`).set(as(t.ownerToken, t.org.id)).send({ reason: 'Problemas con la lotería' }).expect(200);
      const [cancelled] = await logs(t.org.id, 'raffle_cancelled');
      expect((cancelled.variables as { reason: string }).reason).toBe('Problemas con la lotería');
    });

    it('top 10 del ranking: al cerrar (si está activado) y a mano', async () => {
      const t = await createOrg(ctx);
      const cur = await ctx.http.get('/v1/settings/ranking').set(as(t.ownerToken, t.org.id));
      await ctx.http.put('/v1/settings/ranking').set(as(t.ownerToken, t.org.id)).send({ revision: cur.body.revision, data: { ...cur.body.data, enabled: true, announceOnClose: true } }).expect(200);
      const raffle = await createRaffle(ctx, t);
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [4, 5]);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
      const period = await ctx.db.system.rankingPeriod.findFirstOrThrow({ where: { organizationId: t.org.id, status: 'open' } });

      const manual = await ctx.http.post(`/v1/ranking/periods/${period.id}/announce`).set(as(t.ownerToken, t.org.id)).expect(200);
      expect(manual.body.queued).toBe(1);
      expect((await logs(t.org.id, 'ranking_top10'))[0].variables).toMatchObject({ top: '1. Laura M. (2)' });

      await ctx.app.get(RankingService).rollover(t.org.id, period.endsAt);
      const all = await logs(t.org.id, 'ranking_top10');
      expect(all).toHaveLength(2);
      const { participantId } = await ctx.db.system.order.findUniqueOrThrow({ where: { id: o.orderId } });
      expect(all[1].idempotencyKey).toBe(`ranking:${period.id}:close:${participantId}`);
    });

    it('resumen diario a las 8:00 p. m. hora local, una vez por día', async () => {
      const t = await createOrg(ctx);
      await ctx.http.patch('/v1/organization').set(as(t.ownerToken, t.org.id)).send({ supportWhatsapp: '3168110777' }).expect(200);
      await setNotifications(t, { dailyDigest: true });
      const before = new Date('2026-10-25T23:30:00Z'); // 6:30 p. m. en Bogotá
      const at = new Date('2026-10-26T01:30:00Z'); // 8:30 p. m. en Bogotá
      const mine = async () => (await logs(t.org.id, 'daily_digest')).length;
      await notifications.dailyDigest(before);
      expect(await mine()).toBe(0);
      await notifications.dailyDigest(at);
      await notifications.dailyDigest(at);
      expect(await mine()).toBe(1);
      expect((await logs(t.org.id, 'daily_digest'))[0].toPhone).toBe('+573168110777');
    });
  });
});
