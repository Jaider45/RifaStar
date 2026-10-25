import { formatCop, formatNumberList, ticketCode } from '../src/common/format';
import { maskPhone, normalizePhone } from '../src/common/phone';
import { decodeGrid2b, encodeAvailable1b, encodeGrid2b } from '../src/public/grid-encoding';
import { prizeRuleLabel } from '../src/raffles/prize-rules';
import { detectFileType } from '../src/storage/file-type';
import { EXE, PDF, PNG } from './fixtures';

describe('utilidades puras', () => {
  it('etiqueta del anticipado con la hora local', () => {
    const label = prizeRuleLabel(
      { rule: 'anticipated_last_two', customRuleText: null, anticipatedLottery: 'Antioqueñita', anticipatedDrawAt: new Date('2026-10-24T21:00:00Z') },
      'America/Bogota',
    );
    expect(label).toBe('Anticipado con Antioqueñita 4:00 p. m. (dos últimas cifras)');
  });

  it('formatos de dinero, números y tickets', () => {
    expect(formatCop(200000)).toBe('$200.000');
    expect(formatNumberList([7], 2)).toBe('07');
    expect(formatNumberList([7, 23, 99], 2)).toBe('07, 23 y 99');
    expect(ticketCode(42, 7, 2)).toBe('RS-0042-07');
    expect(ticketCode(42, 715, 4)).toBe('RS-0042-0715');
  });

  it('teléfonos E.164 y máscara', () => {
    expect(normalizePhone('300 412 7781')).toBe('+573004127781');
    expect(normalizePhone('+57 300 412 7781')).toBe('+573004127781');
    expect(normalizePhone('573004127781')).toBe('+573004127781');
    expect(() => normalizePhone('12345')).toThrow('El número de WhatsApp no es válido.');
    expect(maskPhone('+573004127781')).toBe('***7781');
  });

  it('detecta el tipo por contenido', () => {
    expect(detectFileType(PNG)).toBe('image/png');
    expect(detectFileType(PDF)).toBe('application/pdf');
    expect(detectFileType(EXE)).toBeNull();
    expect(detectFileType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  it('codificación de la grilla ida y vuelta', () => {
    const taken = [
      { number: 0, status: 'paid' as const },
      { number: 5, status: 'reserved' as const },
      { number: 9999, status: 'pending_verification' as const },
    ];
    const states = decodeGrid2b(encodeGrid2b(10_000, taken), 10_000);
    expect(states[0]).toBe('paid');
    expect(states[5]).toBe('reserved');
    expect(states[9999]).toBe('pending_verification');
    expect(states.filter((s) => s === 'available')).toHaveLength(9997);
    const avail = encodeAvailable1b(100, taken.slice(0, 2));
    expect(avail.length).toBe(13);
    expect((avail[0] >> 0) & 1).toBe(0);
    expect((avail[0] >> 1) & 1).toBe(1);
    expect(avail[12]).toBe(0x0f); // solo 4 bits válidos en el último byte
  });
});
