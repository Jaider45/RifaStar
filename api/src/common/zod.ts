import { z } from 'zod';
import { RESERVED_ORG_SLUGS } from './slug';

export const zUuid = z.string().uuid('Identificador inválido.');
export const zEmail = z.string().trim().toLowerCase().email('El correo no es válido.').max(254);
export const zPassword = z
  .string()
  .min(10, 'La contraseña debe tener al menos 10 caracteres.')
  .max(200, 'La contraseña es demasiado larga.');
export const zName = z.string().trim().min(2, 'Escribe un nombre.').max(120);
export const zOrgSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](-?[a-z0-9])+$/, 'Usa solo letras minúsculas, números y guiones.')
  .min(3, 'La dirección debe tener al menos 3 caracteres.')
  .max(40)
  .refine((s) => !RESERVED_ORG_SLUGS.has(s), 'Esa dirección está reservada.');
export const zTotp = z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos.');
export const zHexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Color inválido.');
export const zTimezone = z.string().refine((tz) => {
  try {
    new Intl.DateTimeFormat('es-CO', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}, 'Zona horaria inválida.');

export const zCursorQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
