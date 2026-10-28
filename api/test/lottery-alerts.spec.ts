import { createHmac } from 'node:crypto';
import { localDateKey } from '../src/common/time';
import { FakeLotteryProvider, LotteryProvider, type ProviderResult } from '../src/lottery/lottery.provider';
import { LotteryService } from '../src/lottery/lottery.service';
import { ManagerAlertsService } from '../src/messaging/manager-alerts.service';
import { BOYACA_PRIZES, createRaffle, reserveAndSubmit } from './fixtures';
import { addMember, as, closeTestApp, createOrg, createTestApp, type TestContext, type TestOrg, freshTotp, resetTotp, totp } from './helpers';

const result = (over: Partial<ProviderResult>): ProviderResult => ({
  draw: 'loteria-de-boyaca',
  name: 'Lotería de Boyacá',
  category: 'loteria',
  draw_date: '2026-10-24',
  winning_number: '4058',
  winning_series: '127',
  status: 'preliminary',
  published_at: '2026-10-24T23:01:02-05:00',
  ...over,
});

describe('Resultados de LoteríaYa y avisos a los gestores (puntos 1 y 2)', () => {
  let ctx: TestContext;
  let t: TestOrg;
  let admin: Awaited<ReturnType<typeof addMember>>;
  let provider: FakeLotteryProvider;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
    admin = await addMember(ctx, t.org.id, 'admin');
    // El admin tiene su WhatsApp verificado: recibe también por WhatsApp.
    await ctx.db.system.user.update({ where: { id: admin.user.id }, data: { phone: '+573001112233', phoneVerifiedAt: new Date() } });
    provider = ctx.app.get(LotteryProvider) as FakeLotteryProvider;
  });
  afterAll(() => closeTestApp(ctx));

  /** Sorteo con la lotería de LoteríaYa que ya jugó (fecha movida al pasado). */
  async function playedRaffle() {
    const raffle = await createRaffle(ctx, t, {
      prizes: BOYACA_PRIZES.map((p) => (p.rule === 'anticipated_last_two' ? { ...p, anticipatedDrawCode: 'antioquenita-tarde' } : p)),
      extra: { lotteryDrawCode: 'loteria-de-boyaca' },
    });
    const drawAt = new Date(Date.now() - 3_600_000);
    await ctx.db.system.raffle.update({ where: { id: raffle.id }, data: { drawAt, salesCloseAt: null } });
    return { raffle, ymd: localDateKey(drawAt, 'America/Bogota') };
  }

  const mailsTo = (email: string, subject: RegExp) => ctx.mail.outbox.filter((m) => m.to === email && subject.test(m.subject));

  it('catálogo de loterías para el constructor', async () => {
    const res = await ctx.http.get('/v1/lotteries').set(as(t.ownerToken, t.org.id)).expect(200);
    expect(res.body).toEqual(expect.arrayContaining([{ code: 'loteria-de-boyaca', name: 'Lotería de Boyacá', category: 'loteria' }]));
  });

  it('informa el resultado a todos los gestores, una vez por dato; el ingreso sigue siendo manual', async () => {
    const { raffle, ymd } = await playedRaffle();
    provider.set(ymd, [result({ draw_date: ymd }), result({ draw: 'antioquenita-tarde', name: 'Antioqueñita Tarde', category: 'chance', draw_date: ymd, winning_number: '1273', winning_series: null })]);

    const lottery = ctx.app.get(LotteryService);
    const first = await lottery.poll();
    expect(first.dates).toEqual([ymd]);
    const ownerMails = mailsTo(t.owner.email, /Resultado de Lotería de Boyacá/);
    expect(ownerMails).toHaveLength(1);
    expect(ownerMails[0].text).toContain('4058 · serie 127 · anticipado Antioqueñita Tarde: 1273');
    expect(ownerMails[0].text).toContain('sin verificar');
    expect(mailsTo(admin.user.email, /Resultado de Lotería de Boyacá/)).toHaveLength(1);
    const wa = await ctx.db.system.messageLog.findMany({ where: { template: 'manager_lottery_result', toPhone: '+573001112233' } });
    expect(wa).toHaveLength(1);

    // Sin cambios: no se repite. Al verificarse: aviso nuevo.
    await lottery.poll();
    expect(mailsTo(t.owner.email, /Resultado de Lotería de Boyacá/)).toHaveLength(1);
    provider.set(ymd, [result({ draw_date: ymd, status: 'confirmed' })]);
    await lottery.poll();
    expect(mailsTo(t.owner.email, /Resultado de Lotería de Boyacá/)).toHaveLength(2);
    expect(mailsTo(t.owner.email, /Resultado de Lotería de Boyacá/)[1].text).toContain('verificado');

    // No se calcula nada solo: el panel muestra el dato como referencia.
    const panel = await ctx.http.get(`/v1/raffles/${raffle.id}/winners`).set(as(t.ownerToken, t.org.id)).expect(200);
    expect(panel.body.result).toBeNull();
    expect(panel.body.lotteryReport.main).toMatchObject({ winningNumber: '4058', winningSeries: '127', status: 'confirmed' });
    expect(panel.body.lotteryReport.anticipated).toMatchObject({ winningNumber: '1273' });
  });

  it('al ingresar el resultado, los gestores reciben los ganadores con su contacto (una vez por revisión)', async () => {
    const { raffle } = await playedRaffle();
    const o = await reserveAndSubmit(ctx, t, raffle.slug, [58], '3004127781');
    await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);

    const put = (main: string) =>
      ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: totp(), mainResult: main, anticipatedResult: '1273' });
    await resetTotp(ctx, t.owner.id);
    await put('4058').expect(200);
    const mail = ctx.mail.lastTo(admin.user.email)!;
    expect(mail.subject).toBe(`Ganadores de «${raffle.title}»`);
    expect(mail.text).toContain('$200.000: 58 — Laura Martínez, +573004127781');
    expect(mail.text).toContain('No vendido');
    const panel = await ctx.http.get(`/v1/raffles/${raffle.id}/winners`).set(as(t.ownerToken, t.org.id)).expect(200);
    expect(panel.body.result.managersNotified).toBe(true);

    const before = ctx.mail.outbox.length;
    await ctx.app.get(ManagerAlertsService).winnersComputed(t.org.id, raffle.id); // misma revisión: nada
    expect(ctx.mail.outbox.length).toBe(before);
    await resetTotp(ctx, t.owner.id);
    await put('4059').expect(200); // corrección → aviso nuevo
    expect(ctx.mail.outbox.length).toBeGreaterThan(before);
  });

  it('recordatorio de entrega solo si la organización lo activa', async () => {
    const { raffle } = await playedRaffle();
    const o = await reserveAndSubmit(ctx, t, raffle.slug, [35]);
    await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    await ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send({ totpCode: await freshTotp(ctx, t.owner.id), mainResult: '2435' }).expect(200);
    await ctx.db.system.drawResult.update({ where: { raffleId: raffle.id }, data: { enteredAt: new Date(Date.now() - 49 * 3_600_000) } });

    const alerts = ctx.app.get(ManagerAlertsService);
    expect(await alerts.deliveryReminders()).toBe(0); // desactivado por defecto

    const cur = await ctx.http.get('/v1/settings/notifications').set(as(t.ownerToken, t.org.id)).expect(200);
    await ctx.http
      .put('/v1/settings/notifications')
      .set(as(t.ownerToken, t.org.id))
      .send({ revision: cur.body.revision, data: { ...cur.body.data, deliveryReminder: true } })
      .expect(200);
    expect(await alerts.deliveryReminders()).toBeGreaterThanOrEqual(1);
    expect(ctx.mail.lastTo(t.owner.email)?.subject).toBe(`Premios por entregar en «${raffle.title}»`);
    expect(await alerts.deliveryReminders()).toBe(0); // ya se recordó en esta ventana
  });

  it('webhook de LoteríaYa: solo con firma válida', async () => {
    const body = JSON.stringify({ result: result({ draw: 'loteria-de-medellin', name: 'Lotería de Medellín', draw_date: '2026-10-23', winning_number: '0907', status: 'confirmed' }) });
    await ctx.http.post('/v1/webhooks/loteriaya').set('Content-Type', 'application/json').send(body).expect(401);
    const process = (await import('node:process')).default;
    process.env.LOTERIAYA_WEBHOOK_SECRET = 'secreto-de-prueba';
    const { resetEnvCache } = await import('../src/config/env');
    resetEnvCache();
    const sig = createHmac('sha256', 'secreto-de-prueba').update(body).digest('hex');
    const ok = await ctx.http.post('/v1/webhooks/loteriaya').set('Content-Type', 'application/json').set('X-LoteriaYa-Signature', `sha256=${sig}`).send(body).expect(200);
    expect(ok.body).toEqual({ received: 1, changed: 1 });
    const stored = await ctx.db.system.lotteryResult.findFirst({ where: { drawCode: 'loteria-de-medellin' } });
    expect(stored).toMatchObject({ winningNumber: '0907', status: 'confirmed' });
    delete process.env.LOTERIAYA_WEBHOOK_SECRET;
    resetEnvCache();
  });
});
