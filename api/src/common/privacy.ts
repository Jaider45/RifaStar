export type NameFormat = 'first_name_initial' | 'initials' | 'nickname';

const words = (name: string) => name.trim().split(/\s+/).filter(Boolean);
const cap = (w: string) => w.charAt(0).toLocaleUpperCase('es-CO') + w.slice(1);

/**
 * Nombre para lo público (regla 7): «Laura M.», «L. M.» o el apodo. Nunca
 * el nombre completo.
 */
export function displayName(p: { name: string; nickname?: string | null }, format: NameFormat): string {
  const parts = words(p.name);
  if (format === 'nickname' && p.nickname?.trim()) return p.nickname.trim();
  if (parts.length === 0) return 'Participante';
  if (format === 'initials') return parts.slice(0, 2).map((w) => `${w.charAt(0).toLocaleUpperCase('es-CO')}.`).join(' ');
  const first = cap(parts[0].toLocaleLowerCase('es-CO'));
  return parts.length > 1 ? `${first} ${parts[1].charAt(0).toLocaleUpperCase('es-CO')}.` : first;
}
