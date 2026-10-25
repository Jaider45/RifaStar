/** Texto libre → enlace en minúsculas sin tildes («Rifas Don Pepe» → «rifas-don-pepe»). */
export const slugify = (s: string, max = 40) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max);
