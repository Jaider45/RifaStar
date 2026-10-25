import type { NumberStatus } from '@prisma/client';

/** Código de 2 bits por número. */
export const GRID_CODES: Record<NumberStatus, number> = {
  available: 0,
  reserved: 1,
  pending_verification: 2,
  paid: 3,
};

/**
 * «bitset-2b»: 4 números por byte; el número n ocupa los bits (n % 4) * 2 del
 * byte n >> 2. 10.000 números = 2.500 bytes (≈3,3 KB en base64).
 */
export function encodeGrid2b(total: number, taken: { number: number; status: NumberStatus }[]): Buffer {
  const buf = Buffer.alloc(Math.ceil(total / 4));
  for (const { number, status } of taken) {
    buf[number >> 2] |= GRID_CODES[status] << ((number & 3) * 2);
  }
  return buf;
}

/** «bitset-1b»: un bit por número, 1 = disponible. */
export function encodeAvailable1b(total: number, taken: { number: number }[]): Buffer {
  const buf = Buffer.alloc(Math.ceil(total / 8), 0xff);
  for (const { number } of taken) buf[number >> 3] &= ~(1 << (number & 7));
  const extra = buf.length * 8 - total;
  if (extra > 0) buf[buf.length - 1] &= 0xff >> extra;
  return buf;
}

export function decodeGrid2b(data: Buffer, total: number): NumberStatus[] {
  const names = Object.entries(GRID_CODES).sort((a, b) => a[1] - b[1]).map(([k]) => k as NumberStatus);
  return Array.from({ length: total }, (_, n) => names[(data[n >> 2] >> ((n & 3) * 2)) & 3]);
}
