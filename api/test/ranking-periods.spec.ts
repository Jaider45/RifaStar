import { periodFor } from '../src/ranking/periods';

describe('Periodos del ranking por zona horaria', () => {
  it('mensual en Bogotá: 31 oct 23:59:59 local es octubre; 1 nov 00:00 local es noviembre', () => {
    const oct = periodFor(new Date('2026-11-01T04:59:59Z'), 'America/Bogota', 'monthly');
    expect(oct).toEqual({
      label: '2026-10',
      startsAt: new Date('2026-10-01T05:00:00Z'),
      endsAt: new Date('2026-11-01T05:00:00Z'),
    });
    expect(periodFor(new Date('2026-11-01T05:00:00Z'), 'America/Bogota', 'monthly').label).toBe('2026-11');
  });

  it('mensual en Madrid con cambio de horario (25 oct y 29 mar)', () => {
    const oct = periodFor(new Date('2026-10-26T12:00:00Z'), 'Europe/Madrid', 'monthly');
    expect(oct.startsAt).toEqual(new Date('2026-09-30T22:00:00Z')); // 1 oct 00:00 CEST (+2)
    expect(oct.endsAt).toEqual(new Date('2026-10-31T23:00:00Z')); // 1 nov 00:00 CET (+1)
    const mar = periodFor(new Date('2027-03-15T12:00:00Z'), 'Europe/Madrid', 'monthly');
    expect(mar.startsAt).toEqual(new Date('2027-02-28T23:00:00Z'));
    expect(mar.endsAt).toEqual(new Date('2027-03-31T22:00:00Z'));
  });

  it('quincenal: 1–15 y 16–fin de mes', () => {
    const first = periodFor(new Date('2026-02-15T23:00:00Z'), 'America/Bogota', 'biweekly'); // 15 feb 18:00 local
    expect(first).toEqual({ label: '2026-02-01', startsAt: new Date('2026-02-01T05:00:00Z'), endsAt: new Date('2026-02-16T05:00:00Z') });
    const second = periodFor(new Date('2026-02-16T05:00:00Z'), 'America/Bogota', 'biweekly');
    expect(second).toEqual({ label: '2026-02-16', startsAt: new Date('2026-02-16T05:00:00Z'), endsAt: new Date('2026-03-01T05:00:00Z') });
  });

  it('semanal: desde el lunes (o el día configurado) a las 00:00 locales', () => {
    // Domingo 25 oct 2026, 20:00 en Bogotá.
    const w = periodFor(new Date('2026-10-26T01:00:00Z'), 'America/Bogota', 'weekly');
    expect(w).toEqual({ label: '2026-10-19', startsAt: new Date('2026-10-19T05:00:00Z'), endsAt: new Date('2026-10-26T05:00:00Z') });
    const saturday = periodFor(new Date('2026-10-26T01:00:00Z'), 'America/Bogota', 'weekly', 6);
    expect(saturday.label).toBe('2026-10-24');
  });
});
