import { createHash, timingSafeEqual } from 'node:crypto';
import type { WompiCredentials, WompiEnvironment, WompiEvent } from './types';

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

/**
 * Firma de integridad de una transacción: SHA-256 de «referencia + monto en centavos + moneda
 * [+ fecha de expiración] + secreto de integridad». Se calcula en el servidor: el secreto nunca
 * viaja al navegador.
 */
export function integritySignature(reference: string, amountInCents: number, currency: string, secret: string, expirationTime?: string): string {
  return sha256(`${reference}${amountInCents}${currency}${expirationTime ?? ''}${secret}`);
}

/** Valor de una ruta como «transaction.amount_in_cents» dentro de `data` del evento. */
function pick(data: Record<string, unknown>, path: string): string {
  let cur: unknown = data;
  for (const part of path.split('.')) {
    cur = cur && typeof cur === 'object' ? (cur as Record<string, unknown>)[part] : undefined;
  }
  return cur === undefined || cur === null ? '' : String(cur);
}

/** Checksum del evento: SHA-256 de los valores de `signature.properties` + timestamp + secreto de eventos. */
export function eventChecksum(event: Pick<WompiEvent, 'data' | 'signature' | 'timestamp'>, eventsSecret: string): string {
  const values = event.signature.properties.map((p) => pick(event.data, p)).join('');
  return sha256(`${values}${event.timestamp}${eventsSecret}`);
}

/** Verifica el checksum del cuerpo (o el de la cabecera X-Event-Checksum, que es el mismo). */
export function verifyEvent(event: WompiEvent, eventsSecret: string): boolean {
  if (!eventsSecret || !event?.signature?.checksum || !Array.isArray(event.signature.properties) || event.timestamp == null) return false;
  const expected = Buffer.from(eventChecksum(event, eventsSecret).toUpperCase());
  const got = Buffer.from(String(event.signature.checksum).toUpperCase());
  return expected.length === got.length && timingSafeEqual(expected, got);
}

const PREFIXES: Record<keyof Omit<WompiCredentials, 'environment'>, { label: string; sandbox: string; production: string }> = {
  publicKey: { label: 'La llave pública', sandbox: 'pub_test_', production: 'pub_prod_' },
  privateKey: { label: 'La llave privada', sandbox: 'prv_test_', production: 'prv_prod_' },
  integritySecret: { label: 'El secreto de integridad', sandbox: 'test_integrity_', production: 'prod_integrity_' },
  eventsSecret: { label: 'El secreto de eventos', sandbox: 'test_events_', production: 'prod_events_' },
};

/**
 * Ambiente según los prefijos de las cuatro llaves. Devuelve un mensaje en español si alguna no
 * tiene el formato de Wompi o si se mezclan llaves de pruebas y de producción.
 */
export function keysEnvironment(keys: Omit<WompiCredentials, 'environment'>): { environment: WompiEnvironment } | { error: string; field: string } {
  const env = keys.publicKey.startsWith(PREFIXES.publicKey.production) ? 'production' : keys.publicKey.startsWith(PREFIXES.publicKey.sandbox) ? 'sandbox' : null;
  if (!env) return { field: 'publicKey', error: 'La llave pública de Wompi empieza por pub_test_ (pruebas) o pub_prod_ (producción).' };
  for (const [field, p] of Object.entries(PREFIXES) as [keyof typeof PREFIXES, (typeof PREFIXES)[keyof typeof PREFIXES]][]) {
    const value = keys[field];
    if (value.startsWith(p[env])) continue;
    const other = env === 'production' ? 'sandbox' : 'production';
    return value.startsWith(p[other])
      ? { field, error: `${p.label} es de ${other === 'sandbox' ? 'pruebas' : 'producción'} y la llave pública es de ${env === 'sandbox' ? 'pruebas' : 'producción'}: usa las cuatro del mismo ambiente.` }
      : { field, error: `${p.label} debe empezar por ${p[env]}. Cópiala de Wompi › Desarrolladores.` };
  }
  return { environment: env };
}
