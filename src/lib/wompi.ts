/**
 * Tokenización de tarjetas con Wompi, directo desde el navegador con la llave PÚBLICA.
 * El número, el CVC y la fecha viajan cifrados a Wompi; a la API de Rifa Star solo llega el token
 * (de un solo uso), así que nuestro servidor nunca ve ni guarda datos de la tarjeta.
 */

export interface CardInput {
  number: string;
  cvc: string;
  /** «1» o «01». */
  expMonth: string;
  /** «30» o «2030». */
  expYear: string;
  holder: string;
}

/** Error con un mensaje listo para mostrar. */
export class CardError extends Error {}

const digits = (s: string) => s.replace(/\D/g, '');

/** Algoritmo de Luhn: detecta errores de digitación antes de molestar a la pasarela. */
export function luhnValid(number: string): boolean {
  const d = digits(number);
  if (d.length < 12) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
  }
  return sum % 10 === 0;
}

/** Mes de dos dígitos y año de dos dígitos, como los pide Wompi. */
export function normalizeExpiry(expMonth: string, expYear: string): { month: string; year: string } {
  const m = digits(expMonth).padStart(2, '0').slice(-2);
  const y = digits(expYear);
  return { month: m, year: y.length >= 4 ? y.slice(-2) : y.padStart(2, '0') };
}

/** Mensaje en español con lo primero que está mal, o null si la tarjeta se ve bien. */
export function validateCard(card: CardInput, now = new Date()): string | null {
  const number = digits(card.number);
  if (!luhnValid(number) || number.length > 19) return 'Revisa el número de la tarjeta.';
  const { month, year } = normalizeExpiry(card.expMonth, card.expYear);
  const m = Number(month);
  if (!(m >= 1 && m <= 12) || year.length !== 2) return 'Revisa la fecha de vencimiento.';
  const expires = new Date(2000 + Number(year), m, 1); // primer instante del mes siguiente
  if (expires <= now) return 'La tarjeta está vencida.';
  if (!/^\d{3,4}$/.test(card.cvc)) return 'El código de seguridad tiene 3 o 4 dígitos.';
  if (card.holder.trim().length < 5) return 'Escribe el nombre como aparece en la tarjeta.';
  return null;
}

const b64url = (data: ArrayBuffer | Uint8Array): string => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END) PUBLIC KEY-----/g, '').replace(/\s+/g, '');
  const raw = atob(body);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

/**
 * JWE compacto (RFC 7516) con alg RSA-OAEP-256 y enc A256GCM, el formato que Wompi recibe en
 * `payload`: cabecera.llaveCifrada.iv.texto.etiqueta.
 */
export async function encryptJwe(publicKeyPem: string, payload: object): Promise<string> {
  const subtle = globalThis.crypto.subtle;
  const rsa = await subtle.importKey('spki', pemToDer(publicKeyPem), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
  const cek = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RSA-OAEP-256', enc: 'A256GCM' })));
  const aes = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  // La cabecera (en ASCII) va como dato autenticado, y la etiqueta son los últimos 16 bytes.
  const sealed = new Uint8Array(
    await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(header), tagLength: 128 }, aes, new TextEncoder().encode(JSON.stringify(payload))),
  );
  const ciphertext = sealed.slice(0, sealed.length - 16);
  const tag = sealed.slice(sealed.length - 16);
  const encryptedKey = await subtle.encrypt({ name: 'RSA-OAEP' }, rsa, cek);
  return [header, b64url(encryptedKey), b64url(iv), b64url(ciphertext), b64url(tag)].join('.');
}

async function wompi<T>(url: string, publicKey: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${publicKey}`, ...(init.body && { 'Content-Type': 'application/json' }) } });
  } catch {
    throw new CardError('No pudimos comunicarnos con el procesador de pagos. Revisa tu conexión e intenta de nuevo.');
  }
  const body = (await res.json().catch(() => ({}))) as { data?: T; error?: { messages?: Record<string, string[]> } };
  if (!res.ok || !body.data) {
    throw new CardError(res.status === 422 ? 'Revisa los datos de la tarjeta e intenta de nuevo.' : 'El procesador de pagos no respondió. Intenta de nuevo en unos minutos.');
  }
  return body.data;
}

/**
 * Convierte los datos de la tarjeta en un token de Wompi. `tokenizeUrl` y `publicKey` los entrega
 * la API (`/checkout` de la orden o `/billing/card-checkout`). Lanza `CardError` con un mensaje claro.
 */
export async function tokenizeCard(opts: { tokenizeUrl: string; publicKey: string; card: CardInput }): Promise<string> {
  const problem = validateCard(opts.card);
  if (problem) throw new CardError(problem);
  const { month, year } = normalizeExpiry(opts.card.expMonth, opts.card.expYear);
  const payload = { number: digits(opts.card.number), cvc: opts.card.cvc, exp_month: month, exp_year: year, card_holder: opts.card.holder.trim() };
  const base = opts.tokenizeUrl.replace(/\/+$/, '');
  const key = await wompi<{ publicKey: string }>(`${base}/tokens/keys/tokenization`, opts.publicKey);
  const jwe = await encryptJwe(key.publicKey, payload);
  const token = await wompi<{ id: string }>(`${base}/tokens/cards`, opts.publicKey, { method: 'POST', body: JSON.stringify({ payload: jwe }) });
  return token.id;
}
