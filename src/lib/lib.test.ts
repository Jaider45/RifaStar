import { describe, expect, it } from 'vitest';
import { cop, pad, soloDigitos } from './format';
import { decodeGrid } from './grid';
import { formatPhone, waLink } from './phone';
import { formatDay, formatTime, isoToZoned, zonedToIso } from './time';

describe('formato', () => {
  it('pesos colombianos con punto de miles', () => {
    expect(cop(0)).toBe('$0');
    expect(cop(6000)).toBe('$6.000');
    expect(cop(1_234_567)).toBe('$1.234.567');
  });

  it('números con ceros a la izquierda según las cifras', () => {
    expect(pad(7)).toBe('07');
    expect(pad(7, 4)).toBe('0007');
    expect(pad(40587, 5)).toBe('40587');
  });

  it('solo dígitos de lo que escribe el usuario', () => {
    expect(soloDigitos('$ 6.000')).toBe(6000);
    expect(soloDigitos('')).toBe(0);
  });
});

describe('fechas en la zona de la organización', () => {
  it('ida y vuelta entre la hora local de Bogotá y UTC', () => {
    const iso = zonedToIso('2026-10-31', '22:40');
    expect(iso).toBe('2026-11-01T03:40:00.000Z');
    expect(isoToZoned(iso!)).toEqual({ date: '2026-10-31', time: '22:40' });
    expect(zonedToIso('', '22:40')).toBeNull();
  });

  it('hora y día legibles, sin espacios raros de Intl', () => {
    const iso = '2026-11-01T03:40:00.000Z';
    expect(formatTime(iso)).toBe('10:40 p. m.');
    expect(formatDay(iso)).toMatch(/^31 (de )?oct$/); // según la versión de ICU de Node
    expect(formatTime(iso)).not.toMatch(/[\u00a0\u202f]/);
  });
});

describe('teléfonos', () => {
  it('formato colombiano y enlace de WhatsApp', () => {
    expect(formatPhone('+573004127781')).toBe('+57 300 412 7781');
    expect(waLink('+57 300 412 7781')).toBe('https://wa.me/573004127781');
    expect(waLink(null)).toBeUndefined();
  });
});

describe('grilla de números', () => {
  it('decodifica 4 estados por byte (2 bits cada uno)', () => {
    // Byte 0b11_10_01_00: número 0 libre, 1 apartado, 2 por verificar, 3 pagado.
    const base64 = btoa(String.fromCharCode(0b11100100));
    expect(decodeGrid(base64, 4)).toEqual(['available', 'reserved', 'pending_verification', 'paid']);
  });
});
