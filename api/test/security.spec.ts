import { PNG } from './fixtures';
import { createRaffle, nextPhone, reserve, reserveAndSubmit } from './fixtures';
import {
  addMember,
  as,
  closeTestApp,
  cookieValue,
  createOrg,
  createTestApp,
  createUser,
  TEST_PASSWORD,
  type TestContext,
  type TestOrg,
  tokenFor,
  totp,
} from './helpers';

describe('Plan de seguridad (puntos 1 a 5)', () => {
  let ctx: TestContext;
  let t: TestOrg;

  beforeAll(async () => {
    ctx = await createTestApp();
    t = await createOrg(ctx);
  });
  afterAll(() => closeTestApp(ctx));

  describe('1 · 2FA obligatorio para quien mueve dinero o resultados', () => {
    it('sin 2FA se consulta, pero no se aprueba; con 2FA sí', async () => {
      const raffle = await createRaffle(ctx, t);
      const verifier = await addMember(ctx, t.org.id, 'payment_verifier');
      await ctx.db.system.user.update({ where: { id: verifier.user.id }, data: { totpEnabledAt: null, totpSecretEnc: null } });

      const me = await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${verifier.token}`).expect(200);
      expect(me.body).toMatchObject({ twoFactorEnabled: false, twoFactorRequired: true });

      const o = await reserveAndSubmit(ctx, t, raffle.slug, [5]);
      await ctx.http.get('/v1/payments/queue').set(as(verifier.token, t.org.id)).expect(200);
      const blocked = await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(verifier.token, t.org.id)).expect(403);
      expect(blocked.body).toMatchObject({ code: 'AUTH_2FA_SETUP_REQUIRED', details: { permissions: ['payments.approve'] } });

      await ctx.db.system.user.update({ where: { id: verifier.user.id }, data: { totpEnabledAt: new Date() } });
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(verifier.token, t.org.id)).expect(200);
    });

    it('el vendedor no necesita 2FA', async () => {
      const seller = await addMember(ctx, t.org.id, 'seller', { sellerCode: `V${Date.now() % 100000}` });
      await ctx.db.system.user.update({ where: { id: seller.user.id }, data: { totpEnabledAt: null } });
      const me = await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${seller.token}`).expect(200);
      expect(me.body.twoFactorRequired).toBe(false);
      await ctx.http.get('/v1/sales/mine').set(as(seller.token, t.org.id)).expect(200);
    });
  });

  describe('2 · equipos nuevos y sesiones', () => {
    it('avisa por correo al entrar desde un equipo nuevo; la primera vez no', async () => {
      const user = await createUser(ctx, 'Gestora Nueva', { twoFactor: false });
      const first = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const device = cookieValue(first, 'rs_dev')!;
      expect(device).toBeTruthy();
      expect(ctx.mail.lastTo(user.email)).toBeUndefined();

      // Mismo equipo: sin aviso.
      await ctx.http.post('/v1/auth/login').set('Cookie', `rs_dev=${device}`).send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      expect(ctx.mail.lastTo(user.email)).toBeUndefined();

      // Otro equipo: aviso.
      await ctx.http.post('/v1/auth/login').set('User-Agent', 'Mozilla/5.0 (iPhone) Safari/604.1').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const mail = ctx.mail.lastTo(user.email)!;
      expect(mail.subject).toBe('Nuevo inicio de sesión en tu cuenta de Rifa Star');
      expect(mail.text).toContain('Safari en iPhone');
    });

    it('lista las sesiones y cierra las demás', async () => {
      const user = await createUser(ctx, 'Gestora Sesiones', { twoFactor: false });
      const a = await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      await ctx.http.post('/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD }).expect(200);
      const rtA = cookieValue(a, 'rs_rt')!;
      const token = a.body.accessToken as string;

      const list = await ctx.http.get('/v1/auth/sessions').set('Authorization', `Bearer ${token}`).set('Cookie', `rs_rt=${rtA}`).expect(200);
      expect(list.body).toHaveLength(2);
      expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

      const closed = await ctx.http.post('/v1/auth/sessions/revoke-others').set('Authorization', `Bearer ${token}`).set('Cookie', `rs_rt=${rtA}`).expect(200);
      expect(closed.body.closed).toBe(1);
      const after = await ctx.http.get('/v1/auth/sessions').set('Authorization', `Bearer ${token}`).set('Cookie', `rs_rt=${rtA}`).expect(200);
      expect(after.body).toHaveLength(1);
    });
  });

  describe('3 · separación de funciones', () => {
    it('nadie aprueba ni rechaza el pago de una venta suya', async () => {
      const raffle = await createRaffle(ctx, t);
      const code = `AD${Date.now() % 100000}`;
      const admin = await addMember(ctx, t.org.id, 'admin', { sellerCode: code });
      const o = await reserveAndSubmit(ctx, t, raffle.slug, [8], undefined, { sellerCode: code });

      const queue = await ctx.http.get('/v1/payments/queue').set(as(admin.token, t.org.id)).expect(200);
      expect(queue.body.find((q: { id: string }) => q.id === o.orderId).alerts.ownSale).toBe(true);

      const self = await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(admin.token, t.org.id)).expect(403);
      expect(self.body.code).toBe('SELF_APPROVAL');
      await ctx.http.post(`/v1/orders/${o.orderId}/reject`).set(as(admin.token, t.org.id)).send({ reason: 'Prueba' }).expect(403);
      await ctx.http.post(`/v1/orders/${o.orderId}/approve`).set(as(t.ownerToken, t.org.id)).expect(200);
    });

    it('ingresar el resultado exige el código de 2FA en el momento', async () => {
      const raffle = await createRaffle(ctx, t);
      const put = (body: object) => ctx.http.put(`/v1/raffles/${raffle.id}/result`).set(as(t.ownerToken, t.org.id)).send(body);
      expect((await put({ mainResult: '2435' }).expect(400)).body.code).toBe('VALIDATION_ERROR');
      expect((await put({ mainResult: '2435', totpCode: '000000' }).expect(401)).body.code).toBe('AUTH_2FA_INVALID');
      await put({ mainResult: '2435', totpCode: totp() }).expect(200);
      const audit = await ctx.db.system.auditLog.findFirst({ where: { organizationId: t.org.id, action: 'result.enter' }, orderBy: { createdAt: 'desc' } });
      expect(audit?.after).toMatchObject({ mainResult: '2435', confirmedWith2fa: true });
    });
  });

  describe('4 · antifraude de comprobantes', () => {
    it('avisa si el mismo archivo se usa en otra orden', async () => {
      const raffle = await createRaffle(ctx, t);
      const same = Buffer.concat([PNG, Buffer.from('el-mismo-archivo')]);
      const a = await reserveAndSubmit(ctx, t, raffle.slug, [30], undefined, { file: same });
      const b = await reserveAndSubmit(ctx, t, raffle.slug, [31], undefined, { file: same });
      const c = await reserveAndSubmit(ctx, t, raffle.slug, [32]);

      const detail = await ctx.http.get(`/v1/orders/${b.orderId}`).set(as(t.ownerToken, t.org.id)).expect(200);
      expect(detail.body.alerts.duplicateReceipt).toEqual([expect.objectContaining({ orderId: a.orderId, participantName: 'Laura Martínez' })]);
      const clean = await ctx.http.get(`/v1/orders/${c.orderId}`).set(as(t.ownerToken, t.org.id)).expect(200);
      expect(clean.body.alerts.duplicateReceipt).toEqual([]);
    });
  });

  describe('5 · antibots en el apartado', () => {
    it('limita los números retenidos sin pagar por teléfono', async () => {
      const own = await createOrg(ctx);
      const cur = await ctx.http.get('/v1/settings/payments').set(as(own.ownerToken, own.org.id)).expect(200);
      await ctx.http
        .put('/v1/settings/payments')
        .set(as(own.ownerToken, own.org.id))
        .send({ revision: cur.body.revision, data: { ...cur.body.data, maxHeldPerPhone: 3 } })
        .expect(200);
      const raffle = await createRaffle(ctx, own);
      const phone = nextPhone();
      expect((await reserve(ctx, own, raffle.slug, { numbers: [1, 2], phone })).status).toBe(201);
      const over = await reserve(ctx, own, raffle.slug, { numbers: [3, 4], phone });
      expect(over.status).toBe(429);
      expect(over.body).toMatchObject({ code: 'HOLD_LIMIT', details: { limit: 3, held: 2 } });
      expect((await reserve(ctx, own, raffle.slug, { numbers: [3], phone })).status).toBe(201);
      // Otro teléfono no se ve afectado.
      expect((await reserve(ctx, own, raffle.slug, { numbers: [5, 6, 7] })).status).toBe(201);
    });
  });

  describe('WhatsApp verificado del gestor', () => {
    it('se confirma con un código que llega a ese número', async () => {
      const token = tokenFor(ctx, t.owner.id);
      await ctx.http.post('/v1/me/phone').set(as(token, t.org.id)).send({ phone: '300 555 1212' }).expect(202);
      const log = await ctx.db.system.messageLog.findFirst({ where: { template: 'phone_verify_code', toPhone: '+573005551212' }, orderBy: { createdAt: 'desc' } });
      const code = (log!.variables as { code: string }).code;

      expect((await ctx.http.post('/v1/me/phone/verify').set(as(token, t.org.id)).send({ code: code === '000000' ? '111111' : '000000' }).expect(422)).body.code).toBe('PHONE_CODE_INVALID');
      const ok = await ctx.http.post('/v1/me/phone/verify').set(as(token, t.org.id)).send({ code }).expect(200);
      expect(ok.body).toEqual({ phone: '+573005551212', phoneVerified: true });
      const me = await ctx.http.get('/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
      expect(me.body).toMatchObject({ phone: '+573005551212', phoneVerified: true });
    });
  });
});
