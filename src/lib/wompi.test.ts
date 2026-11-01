// @vitest-environment node
// Node trae WebCrypto completo (el entorno jsdom no), igual que un navegador.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CardError, encryptJwe, formatExpiry, luhnValid, normalizeExpiry, tokenizeCard, validateCard } from './wompi';

const card = { number: '4242 4242 4242 4242', cvc: '123', expMonth: '12', expYear: '2099', holder: 'LAURA MARTINEZ' };
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64'));

/** Par de llaves RSA como el que publica Wompi (clave pública en PEM). */
async function rsaPair() {
  const pair = await crypto.subtle.generateKey({ name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['encrypt', 'decrypt']);
  const spki = Buffer.from(await crypto.subtle.exportKey('spki', pair.publicKey)).toString('base64');
  const pem = `-----BEGIN PUBLIC KEY-----\n${spki.match(/.{1,64}/g)!.join('\n')}\n-----END PUBLIC KEY-----`;
  return { pem, privateKey: pair.privateKey };
}

/** Descifra un JWE compacto RSA-OAEP-256 + A256GCM (lo que haría Wompi con su llave privada). */
async function decryptJwe(jwe: string, privateKey: CryptoKey) {
  const [header, encryptedKey, iv, ciphertext, tag] = jwe.split('.');
  const cek = await crypto.subtle.decrypt({ name: 'RSA-OAEP' }, privateKey, unb64(encryptedKey));
  const aes = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt']);
  const sealed = new Uint8Array([...unb64(ciphertext), ...unb64(tag)]);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv), additionalData: new TextEncoder().encode(header), tagLength: 128 }, aes, sealed);
  return { header: JSON.parse(Buffer.from(unb64(header)).toString()), payload: JSON.parse(new TextDecoder().decode(plain)) };
}

describe('validación de tarjeta', () => {
  it('Luhn: acepta las tarjetas de prueba de Wompi y rechaza errores de digitación', () => {
    expect(luhnValid('4242 4242 4242 4242')).toBe(true);
    expect(luhnValid('4111111111111111')).toBe(true);
    expect(luhnValid('4242 4242 4242 4241')).toBe(false);
    expect(luhnValid('1234')).toBe(false);
  });

  it('fecha: acepta mes con o sin cero y año de 2 o 4 dígitos', () => {
    expect(normalizeExpiry('1', '2030')).toEqual({ month: '01', year: '30' });
    expect(normalizeExpiry('12', '30')).toEqual({ month: '12', year: '30' });
  });

  it('fecha: pone la barra sola mientras se escribe y respeta la que escribe la persona', () => {
    expect(formatExpiry('12')).toBe('12');
    expect(formatExpiry('123')).toBe('12/3');
    expect(formatExpiry('1230')).toBe('12/30');
    expect(formatExpiry('12/30')).toBe('12/30');
    expect(formatExpiry('1/30')).toBe('1/30');
    expect(formatExpiry('12/')).toBe('12/'); // al borrar el año no se pierde la barra de golpe
    expect(formatExpiry('12/2030')).toBe('12/2030');
    expect(formatExpiry('12a3b0')).toBe('12/30');
  });

  it('dice en español qué está mal', () => {
    const now = new Date('2026-10-31T12:00:00Z');
    expect(validateCard(card, now)).toBeNull();
    expect(validateCard({ ...card, number: '4242 4242 4242 4241' }, now)).toBe('Revisa el número de la tarjeta.');
    expect(validateCard({ ...card, expMonth: '13' }, now)).toBe('Revisa la fecha de vencimiento.');
    expect(validateCard({ ...card, expMonth: '9', expYear: '26' }, now)).toBe('La tarjeta está vencida.');
    expect(validateCard({ ...card, expMonth: '10', expYear: '26' }, now)).toBeNull(); // vence al final del mes
    expect(validateCard({ ...card, cvc: '12' }, now)).toBe('El código de seguridad tiene 3 o 4 dígitos.');
    expect(validateCard({ ...card, holder: 'Ana' }, now)).toBe('Escribe el nombre como aparece en la tarjeta.');
  });
});

describe('cifrado de la tarjeta (JWE)', () => {
  it('se puede descifrar con la llave privada y la cabecera es la que Wompi espera', async () => {
    const { pem, privateKey } = await rsaPair();
    const jwe = await encryptJwe(pem, { number: '4242424242424242', cvc: '123', exp_month: '12', exp_year: '30', card_holder: 'LAURA MARTINEZ' });
    expect(jwe.split('.')).toHaveLength(5);
    expect(jwe).not.toContain('4242424242424242');
    const out = await decryptJwe(jwe, privateKey);
    expect(out.header).toEqual({ alg: 'RSA-OAEP-256', enc: 'A256GCM' });
    expect(out.payload).toEqual({ number: '4242424242424242', cvc: '123', exp_month: '12', exp_year: '30', card_holder: 'LAURA MARTINEZ' });
  });

  it('cada cifrado es distinto (clave e IV aleatorios)', async () => {
    const { pem } = await rsaPair();
    expect(await encryptJwe(pem, { a: 1 })).not.toBe(await encryptJwe(pem, { a: 1 }));
  });
});

describe('tokenizeCard', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('pide la llave, envía solo el JWE a Wompi y devuelve el token; la tarjeta nunca sale en claro', async () => {
    const { pem, privateKey } = await rsaPair();
    const calls: { url: string; init?: RequestInit }[] = [];
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const data = url.endsWith('/tokens/keys/tokenization') ? { publicKey: pem } : { id: 'tok_test_4242_abc' };
      return new Response(JSON.stringify({ data }), { status: url.endsWith('/tokens/cards') ? 201 : 200 });
    });
    const token = await tokenizeCard({ tokenizeUrl: 'https://sandbox.wompi.co/v1/', publicKey: 'pub_test_x', card });
    expect(token).toBe('tok_test_4242_abc');
    expect(calls.map((c) => c.url)).toEqual(['https://sandbox.wompi.co/v1/tokens/keys/tokenization', 'https://sandbox.wompi.co/v1/tokens/cards']);
    expect((calls[1].init!.headers as Record<string, string>).Authorization).toBe('Bearer pub_test_x');
    const body = String(calls[1].init!.body);
    expect(body).not.toContain('4242');
    const sent = JSON.parse(body) as { payload: string };
    expect(Object.keys(sent)).toEqual(['payload']);
    expect((await decryptJwe(sent.payload, privateKey)).payload).toMatchObject({ number: '4242424242424242', exp_year: '99', card_holder: 'LAURA MARTINEZ' });
  });

  it('no llama a Wompi si la tarjeta es inválida', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(tokenizeCard({ tokenizeUrl: 'https://x', publicKey: 'k', card: { ...card, number: '4242424242424241' } })).rejects.toThrow('Revisa el número de la tarjeta.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('traduce los errores de Wompi y de red a mensajes claros', async () => {
    vi.stubGlobal('fetch', async () => new Response('{}', { status: 422 }));
    await expect(tokenizeCard({ tokenizeUrl: 'https://x', publicKey: 'k', card })).rejects.toThrow('Revisa los datos de la tarjeta');
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('network');
    });
    const err = await tokenizeCard({ tokenizeUrl: 'https://x', publicKey: 'k', card }).catch((e) => e);
    expect(err).toBeInstanceOf(CardError);
    expect(err.message).toContain('Revisa tu conexión');
  });
});
