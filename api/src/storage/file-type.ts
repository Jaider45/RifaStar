/**
 * Detección del tipo real de un archivo por sus primeros bytes («magic
 * numbers»), sin confiar en la extensión ni en el Content-Type del cliente.
 */
export type DetectedType =
  | 'image/jpeg'
  | 'image/png'
  | 'image/webp'
  | 'image/heic'
  | 'application/pdf'
  | 'video/mp4'
  | 'video/quicktime';

const startsWith = (buf: Buffer, bytes: number[], offset = 0) =>
  buf.length >= offset + bytes.length && bytes.every((b, i) => buf[offset + i] === b);

const ascii = (buf: Buffer, start: number, end: number) => buf.subarray(start, end).toString('latin1');

export function detectFileType(buf: Buffer): DetectedType | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (ascii(buf, 0, 4) === 'RIFF' && ascii(buf, 8, 12) === 'WEBP') return 'image/webp';
  if (ascii(buf, 0, 5) === '%PDF-') return 'application/pdf';
  if (ascii(buf, 4, 8) === 'ftyp') {
    const brand = ascii(buf, 8, 12);
    if (['heic', 'heix', 'hevc', 'heim', 'heis', 'mif1', 'msf1'].includes(brand)) return 'image/heic';
    if (brand === 'qt  ') return 'video/quicktime';
    if (['isom', 'iso2', 'mp41', 'mp42', 'avc1', 'M4V ', 'dash'].includes(brand)) return 'video/mp4';
  }
  return null;
}

export const RECEIPT_TYPES: ReadonlySet<DetectedType> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'application/pdf',
]);
export const IMAGE_TYPES: ReadonlySet<DetectedType> = new Set(['image/jpeg', 'image/png', 'image/webp']);
export const EVIDENCE_TYPES: ReadonlySet<DetectedType> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'video/mp4',
  'video/quicktime',
]);

export const MB = 1024 * 1024;
