import { addDays, addMonths } from 'date-fns';
import { localToUtc, utcToLocal } from '../common/time';

export type RankingFrequency = 'monthly' | 'biweekly' | 'weekly';

export interface PeriodBounds {
  startsAt: Date;
  /** Exclusivo. */
  endsAt: Date;
  /** «2026-10» (mensual) o «2026-10-16» (fecha de inicio para quincenal y semanal). */
  label: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dateLabel = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Periodo que contiene `instant`, calculado en la hora local de `tz` (P8):
 * - mensual: día 1 a las 00:00 locales;
 * - quincenal: del 1 al 15 y del 16 a fin de mes;
 * - semanal: desde `weeklyResetDay` (1 = lunes … 7 = domingo) a las 00:00.
 * Las fechas se arman «de pared» y se convierten a UTC, así los cambios de
 * horario de verano no corren los límites.
 */
export function periodFor(instant: Date, tz: string, frequency: RankingFrequency, weeklyResetDay = 1): PeriodBounds {
  const local = utcToLocal(instant, tz);
  const y = local.getFullYear();
  const m = local.getMonth();

  if (frequency === 'monthly') {
    const start = new Date(y, m, 1);
    return { startsAt: localToUtc(start, tz), endsAt: localToUtc(addMonths(start, 1), tz), label: `${y}-${pad(m + 1)}` };
  }

  if (frequency === 'biweekly') {
    const firstHalf = local.getDate() <= 15;
    const start = new Date(y, m, firstHalf ? 1 : 16);
    const end = firstHalf ? new Date(y, m, 16) : addMonths(new Date(y, m, 1), 1);
    return { startsAt: localToUtc(start, tz), endsAt: localToUtc(end, tz), label: dateLabel(start) };
  }

  // Semanal: ISO 1..7 → getDay() 0..6 (domingo = 0).
  const isoToday = local.getDay() === 0 ? 7 : local.getDay();
  const back = (isoToday - weeklyResetDay + 7) % 7;
  const start = addDays(new Date(y, m, local.getDate()), -back);
  return { startsAt: localToUtc(start, tz), endsAt: localToUtc(addDays(start, 7), tz), label: dateLabel(start) };
}

/** Acepta «current», «YYYY-MM» o «YYYY-MM-DD». */
export const PERIOD_PARAM_RE = /^(current|\d{4}-\d{2}(-\d{2})?)$/;
