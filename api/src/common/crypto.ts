import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env';

export const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/** HMAC con el pepper del servidor: para códigos OTP y tokens de un solo uso. */
export const pepperedHash = (value: string): string =>
  createHmac('sha256', env().HASH_PEPPER).update(value).digest('hex');

export const randomToken = (bytes = 32): string => randomBytes(bytes).toString('base64url');

export const randomDigits = (length: number): string =>
  Array.from({ length }, () => randomInt(0, 10)).join('');

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** AES-256-GCM: iv.tag.ciphertext en base64url. */
export function encrypt(plain: string): string {
  const key = Buffer.from(env().ENCRYPTION_KEY, 'base64');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const key = Buffer.from(env().ENCRYPTION_KEY, 'base64');
  const [iv, tag, data] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
