import { FakeStorageProvider, StorageProvider } from '../src/storage/storage.provider';
import { as, type TestContext, type TestOrg, uid } from './helpers';

export const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
export const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(200, 2)]);
export const EXE = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(200, 3)]);

export const BOYACA_PRIZES = [
  { amountCop: 200_000, rule: 'last_two' },
  { amountCop: 80_000, rule: 'first_two' },
  { amountCop: 70_000, rule: 'middle_two' },
  { amountCop: 50_000, rule: 'digits_1_and_4' },
  { amountCop: 30_000, rule: 'anticipated_last_two', anticipatedLottery: 'Antioqueñita' },
];

export const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export interface RaffleOpts {
  digits?: 2 | 3 | 4;
  price?: number;
  minPerOrder?: number;
  salesCloseAt?: string | null;
  publish?: boolean;
  prizes?: object[];
}

export async function ensurePaymentAccount(ctx: TestContext, t: TestOrg): Promise<string> {
  const res = await ctx.http
    .post('/v1/payment-accounts')
    .set(as(t.ownerToken, t.org.id))
    .send({ type: 'bre_b', keyOrNumber: '3168110777', holderName: 'José Rodríguez' })
    .expect(201);
  return res.body.id;
}

/** Crea (y por defecto publica) un sorteo vía API. */
export async function createRaffle(ctx: TestContext, t: TestOrg, opts: RaffleOpts = {}) {
  const digits = opts.digits ?? 2;
  await ensurePaymentAccount(ctx, t);
  const res = await ctx.http
    .post('/v1/raffles')
    .set(as(t.ownerToken, t.org.id))
    .send({
      title: `Gana con Boyacá ${uid()}`,
      lottery: 'Lotería de Boyacá',
      drawAt: inHours(48),
      salesCloseAt: opts.salesCloseAt === undefined ? inHours(40) : opts.salesCloseAt,
      pricePerNumber: opts.price ?? 6000,
      digits,
      minPerOrder: opts.minPerOrder ?? 1,
      prizes: opts.prizes ?? (digits === 2 ? BOYACA_PRIZES : [{ amountCop: 1_000_000, rule: digits === 3 ? 'last_three' : 'full_number' }]),
    })
    .expect(201);
  if (opts.publish === false) return res.body;
  const pub = await ctx.http.post(`/v1/raffles/${res.body.id}/publish`).set(as(t.ownerToken, t.org.id)).expect(200);
  return pub.body;
}

export function storage(ctx: TestContext): FakeStorageProvider {
  return ctx.app.get(StorageProvider) as FakeStorageProvider;
}

let phoneSeq = 1000;
/** Celular colombiano válido y único por test. */
export const nextPhone = () => `300${String(Date.now() % 10_000).padStart(4, '0')}${String(phoneSeq++ % 1000).padStart(3, '0')}`;

export async function reserve(
  ctx: TestContext,
  t: TestOrg,
  raffleSlug: string,
  body: { numbers?: number[]; random?: number; name?: string; phone?: string; sellerCode?: string },
) {
  return ctx.http
    .post(`/v1/public/orgs/${t.org.slug}/raffles/${raffleSlug}/orders`)
    .set('X-Forwarded-For', `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`)
    .send({ ...body, name: body.name ?? 'Laura Martínez', phone: body.phone ?? nextPhone() });
}

/** Aparta, sube un comprobante PNG y lo confirma. Devuelve la orden. */
export async function reserveAndSubmit(ctx: TestContext, t: TestOrg, raffleSlug: string, numbers: number[], phone?: string) {
  const order = await reserve(ctx, t, raffleSlug, { numbers, phone });
  if (order.status !== 201) throw new Error(`reserve ${order.status}: ${JSON.stringify(order.body)}`);
  const up = await ctx.http
    .post(`/v1/public/orders/${order.body.orderId}/receipt`)
    .set('X-Order-Token', order.body.accessToken)
    .send({ contentType: 'image/png', size: PNG.length })
    .expect(201);
  storage(ctx).put(up.body.key, PNG);
  await ctx.http
    .post(`/v1/public/orders/${order.body.orderId}/receipt/confirm`)
    .set('X-Order-Token', order.body.accessToken)
    .send({ key: up.body.key })
    .expect(200);
  return order.body as { orderId: string; accessToken: string; numbers: string[] };
}
