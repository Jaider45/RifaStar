import { addDays, addMonths, startOfMonth, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

/**
 * Utilidades de calendario por zona horaria. Todo se guarda en UTC; los
 * límites (inicio de semana, de mes, 8:00 p. m.) se calculan en la hora local
 * de la organización y se devuelven como instantes UTC.
 */

/** Fecha «de pared» local → instante UTC. */
export const localToUtc = (local: Date, tz: string): Date => fromZonedTime(local, tz);
/** Instante UTC → fecha «de pared» local (los campos getX() dan la hora local). */
export const utcToLocal = (instant: Date, tz: string): Date => toZonedTime(instant, tz);

export function startOfLocalWeek(instant: Date, tz: string, weekStartsOn: 0 | 1 | 2 | 3 | 4 | 5 | 6 = 1): Date {
  return localToUtc(startOfWeek(utcToLocal(instant, tz), { weekStartsOn }), tz);
}

export function startOfLocalMonth(instant: Date, tz: string): Date {
  return localToUtc(startOfMonth(utcToLocal(instant, tz)), tz);
}

export function startOfLocalDay(instant: Date, tz: string): Date {
  const local = utcToLocal(instant, tz);
  return localToUtc(new Date(local.getFullYear(), local.getMonth(), local.getDate()), tz);
}

/** «2026-10» en la zona dada. */
export function localMonthKey(instant: Date, tz: string): string {
  const l = utcToLocal(instant, tz);
  return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, '0')}`;
}

export function localDateKey(instant: Date, tz: string): string {
  const l = utcToLocal(instant, tz);
  return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, '0')}-${String(l.getDate()).padStart(2, '0')}`;
}

export { addDays, addMonths };
