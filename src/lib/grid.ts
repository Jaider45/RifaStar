export type NumberState = 'available' | 'reserved' | 'pending_verification' | 'paid';
const NAMES: NumberState[] = ['available', 'reserved', 'pending_verification', 'paid'];

/** Decodifica la grilla «bitset-2b» de la API (4 números por byte). */
export function decodeGrid(base64: string, total: number): NumberState[] {
  const bin = atob(base64);
  return Array.from({ length: total }, (_, n) => NAMES[(bin.charCodeAt(n >> 2) >> ((n & 3) * 2)) & 3]);
}
