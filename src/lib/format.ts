/** $6.000 — pesos colombianos con punto de miles, sin decimales. */
export function cop(n: number): string {
  return '$' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Boletos siempre con ceros a la izquierda: 7 → "07" (2 cifras), "0007" (4 cifras). */
export function pad(n: number, cifras = 2): string {
  return String(n).padStart(cifras, '0');
}

export function soloDigitos(s: string): number {
  return parseInt(s.replace(/\D/g, ''), 10) || 0;
}

const DIAS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** "2026-10-24" + "22:40" → "sáb 24 oct · 10:40 p. m." */
export function fechaSorteo(fecha: string, hora: string): string {
  const [y, m, d] = fecha.split('-').map(Number);
  if (!y || !m || !d) return 'Sin fecha';
  const dia = new Date(y, m - 1, d);
  return `${DIAS[dia.getDay()]} ${d} ${MESES[m - 1]} · ${hora12(hora)}`;
}

export function hora12(hora: string): string {
  const [h, min] = hora.split(':').map(Number);
  if (Number.isNaN(h)) return '';
  const sufijo = h >= 12 ? 'p. m.' : 'a. m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(min || 0)} ${sufijo}`;
}
