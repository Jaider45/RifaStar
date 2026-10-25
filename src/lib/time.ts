/** Fechas en la zona horaria de la organización (la API guarda todo en UTC). */
export const DEFAULT_TZ = 'America/Bogota';

function partsIn(date: Date, tz: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second };
}

/** Diferencia (ms) entre la hora local de `tz` y UTC en ese instante. */
function offset(date: Date, tz: string): number {
  const p = partsIn(date, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - date.getTime();
}

/** «2026-10-24» + «22:40» en `tz` → ISO UTC. */
export function zonedToIso(date: string, time: string, tz = DEFAULT_TZ): string | null {
  const [y, m, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  if (!y || !m || !d || Number.isNaN(h) || Number.isNaN(mi)) return null;
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offset(new Date(guess), tz);
  const exact = guess - offset(new Date(first), tz);
  return new Date(exact).toISOString();
}

/** ISO UTC → { date: «2026-10-24», time: «22:40» } en `tz`. */
export function isoToZoned(iso: string, tz = DEFAULT_TZ): { date: string; time: string } {
  const p = partsIn(new Date(iso), tz);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

const clean = (s: string) => s.replace(/\./g, '').replace(/[\s  ]+/g, ' ').trim();

/** «sáb 24 oct · 10:40 p. m.» */
export function formatDraw(iso: string, tz = DEFAULT_TZ): string {
  const d = new Date(iso);
  const day = clean(new Intl.DateTimeFormat('es-CO', { weekday: 'short', day: 'numeric', month: 'short', timeZone: tz }).format(d)).replace(',', '');
  return `${day} · ${formatTime(iso, tz)}`;
}

/** «10:40 p. m.» */
export function formatTime(iso: string, tz = DEFAULT_TZ): string {
  return new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: tz })
    .format(new Date(iso))
    .replace(/[\s  ]+/g, ' ');
}

/** «24 oct» */
export function formatDay(iso: string, tz = DEFAULT_TZ): string {
  return clean(new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'short', timeZone: tz }).format(new Date(iso)));
}

/** «Sábado 31 de octubre» */
export function formatLongDay(iso: string, tz = DEFAULT_TZ): string {
  const s = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: tz }).format(new Date(iso)).replace(',', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** «hace 4 min», «hace 2 h», «hace 3 días» */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'hace un momento';
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'ayer' : `hace ${d} días`;
}

/** «octubre 2026» a partir de «2026-10». */
export function monthLabel(label: string): string {
  const [y, m] = label.split('-').map(Number);
  if (!y || !m) return label;
  const name = new Intl.DateTimeFormat('es-CO', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 15)));
  return label.length > 7 ? `desde el ${label.slice(8)} de ${name}` : `${name} ${y}`;
}
