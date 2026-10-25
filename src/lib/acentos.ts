/** Colores de acento de los sorteos (la API guarda el hex). */
export interface Acento {
  id: 'verde' | 'rojo' | 'dorado' | 'blanco';
  nombre: string;
  color: string;
  on: string;
}

export const ACENTOS: Acento[] = [
  { id: 'verde', nombre: 'Verde Rifa Star', color: '#7eb742', on: '#0b0b0c' },
  { id: 'rojo', nombre: 'Rojo', color: '#ab1f24', on: '#ffffff' },
  { id: 'dorado', nombre: 'Dorado', color: '#ffc53d', on: '#121212' },
  { id: 'blanco', nombre: 'Blanco', color: '#f5f5f2', on: '#0b0b0c' },
];

export function acentoPorColor(hex: string | null | undefined): Acento {
  return ACENTOS.find((a) => a.color.toLowerCase() === hex?.toLowerCase()) ?? ACENTOS[0];
}

export const LOTERIAS = [
  'Lotería de Boyacá',
  'Lotería de Medellín',
  'Lotería de Bogotá',
  'Lotería de Cundinamarca',
  'Lotería del Valle',
  'Lotería de Santander',
  'Sorteo propio en vivo',
];
