/** Colores de acento de los sorteos (la API guarda el hex). */
export interface Acento {
  id: string;
  nombre: string;
  color: string;
  /** Texto e iconos encima del acento: el que tenga más contraste. */
  on: string;
}

export const ACENTOS: Acento[] = [
  { id: 'verde', nombre: 'Verde Rifa Star', color: '#7eb742', on: '#0b0b0c' },
  { id: 'rojo', nombre: 'Rojo', color: '#ab1f24', on: '#ffffff' },
  { id: 'dorado', nombre: 'Dorado', color: '#ffc53d', on: '#121212' },
  { id: 'blanco', nombre: 'Blanco', color: '#f5f5f2', on: '#0b0b0c' },
];

const HEX_RE = /^#[0-9a-f]{6}$/i;

/** Luminancia relativa (WCAG 2.x) de un color #rrggbb. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Negro o blanco, el que se lea mejor sobre `hex`. */
export function onColor(hex: string): string {
  return contrastRatio(hex, '#0b0b0c') >= contrastRatio(hex, '#ffffff') ? '#0b0b0c' : '#ffffff';
}

/** Acento para cualquier color: el predefinido si coincide, o uno libre con su texto calculado. */
export function acentoPorColor(hex: string | null | undefined): Acento {
  const preset = ACENTOS.find((a) => a.color.toLowerCase() === hex?.toLowerCase());
  if (preset) return preset;
  if (hex && HEX_RE.test(hex)) return { id: 'libre', nombre: 'Color propio', color: hex.toLowerCase(), on: onColor(hex) };
  return ACENTOS[0];
}

/** Respaldo si el catálogo de LoteríaYa no responde. */
export const LOTERIAS = [
  'Lotería de Boyacá',
  'Lotería de Medellín',
  'Lotería de Bogotá',
  'Lotería de Cundinamarca',
  'Lotería del Valle',
  'Lotería de Santander',
  'Sorteo propio en vivo',
];
