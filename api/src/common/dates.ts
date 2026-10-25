/** «sáb 24 oct · 10:40 p. m.» en la zona de la organización. */
export function formatDrawDate(date: Date, tz: string): string {
  const day = new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(date);
  return `${day.replace(/\./g, '').replace(',', '')} · ${formatTime(date, tz)}`;
}

/** «10:40 p. m.» */
export function formatTime(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
    .format(date)
    .replace(/[\s\u00a0\u202f]+/g, ' ');
}
