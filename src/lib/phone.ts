/** «+573004127781» → «+57 300 412 7781» */
export function formatPhone(e164: string | null | undefined): string {
  if (!e164) return '';
  const m = /^\+57(\d{3})(\d{3})(\d{4})$/.exec(e164);
  return m ? `+57 ${m[1]} ${m[2]} ${m[3]}` : e164;
}

export const waLink = (phone: string | null | undefined) => (phone ? `https://wa.me/${phone.replace(/\D/g, '')}` : undefined);

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
