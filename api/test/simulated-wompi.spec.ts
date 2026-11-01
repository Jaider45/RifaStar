import { constants, createCipheriv, publicEncrypt, randomBytes } from 'node:crypto';
import { env, wompiDriver } from '../src/config/env';
import { closeTestApp, createTestApp, type TestContext } from './helpers';

/** JWE armado con crypto de Node, sin código del proyecto: así se prueba el formato, no mi propia lectura. */
function jwe(publicKeyPem: string, payload: object): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })).toString('base64url');
  const cek = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', cek, iv);
  cipher.setAAD(Buffer.from(header));
  const ct = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  const ek = publicEncrypt({ key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, cek);
  return [header, ek.toString('base64url'), iv.toString('base64url'), ct.toString('base64url'), cipher.getAuthTag().toString('base64url')].join('.');
}

const card = (number: string) => ({ number, cvc: '123', exp_month: '12', exp_year: '30', card_holder: 'LAURA MARTINEZ' });

describe('Tokenización simulada de Wompi (solo desarrollo)', () => {
  let ctx: TestContext;
  beforeAll(async () => {
    ctx = await createTestApp();
  });
  afterAll(() => closeTestApp(ctx));

  const key = async () => (await ctx.http.get('/v1/dev/wompi/tokens/keys/tokenization').expect(200)).body.data.publicKey as string;

  it('entrega una llave pública y devuelve un token cuyo final es el de la tarjeta', async () => {
    const pem = await key();
    expect(pem).toContain('BEGIN PUBLIC KEY');
    const ok = await ctx.http.post('/v1/dev/wompi/tokens/cards').send({ payload: jwe(pem, card('4242424242424242')) }).expect(201);
    expect(ok.body.data.id).toMatch(/^tok_sim_[0-9a-f]{12}_4242$/);
    expect(JSON.stringify(ok.body)).not.toContain('4242424242424242');
    const declined = await ctx.http.post('/v1/dev/wompi/tokens/cards').send({ payload: jwe(pem, card('4111111111111111')) }).expect(201);
    expect(declined.body.data.id).toMatch(/_1111$/);
  });

  it('rechaza tarjetas inválidas, cifrados rotos y datos en claro', async () => {
    const pem = await key();
    await ctx.http.post('/v1/dev/wompi/tokens/cards').send({ payload: jwe(pem, card('4242424242424241')) }).expect(422); // Luhn
    await ctx.http.post('/v1/dev/wompi/tokens/cards').send({ payload: 'a.b.c.d.e' }).expect(422);
    await ctx.http.post('/v1/dev/wompi/tokens/cards').send(card('4242424242424242')).expect(422); // sin cifrar
    const tampered = jwe(pem, card('4242424242424242')).split('.');
    tampered[3] = Buffer.from('manipulado').toString('base64url');
    await ctx.http.post('/v1/dev/wompi/tokens/cards').send({ payload: tampered.join('.') }).expect(422);
  });

  it('en producción el driver simulado es imposible aunque se pida', () => {
    expect(wompiDriver({ ...env(), NODE_ENV: 'production', WOMPI_DRIVER: 'fake' })).toBe('wompi');
    expect(wompiDriver({ ...env(), NODE_ENV: 'development', WOMPI_DRIVER: 'fake' })).toBe('fake');
  });
});
