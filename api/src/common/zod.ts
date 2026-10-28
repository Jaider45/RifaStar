import { z } from 'zod';
import { RESERVED_ORG_SLUGS } from './slug';

type WithoutDefault<S> = S extends z.ZodDefault<infer I> ? I : S;
type PatchShape<T extends z.ZodRawShape> = { [K in keyof T]: z.ZodOptional<WithoutDefault<T[K]>> };

/**
 * Esquema para PATCH: los mismos campos, todos opcionales y SIN sus valores por defecto.
 * (Zod 4 aplica los `.default()` también dentro de `.partial()`: un PATCH con solo el precio
 * volvería a poner la compra mínima en 1, el nombre de la unidad en «número», etc.)
 */
export function patchOf<T extends z.ZodRawShape>(schema: z.ZodObject<T>): z.ZodObject<PatchShape<T>> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]) => [key, ((field instanceof z.ZodDefault ? field.removeDefault() : field) as z.ZodType).optional()]),
  );
  return z.object(shape) as unknown as z.ZodObject<PatchShape<T>>;
}

/**
 * Fecha recibida por la API: texto ISO 8601 con zona («2026-10-30T22:40:00-05:00», «…Z») o solo
 * la fecha («2026-10-30»), convertida a Date. (Con zod 4 un `z.coerce.date()` no se puede
 * documentar en OpenAPI; así el contrato dice «string, formato date-time».)
 */
export const zDateTime = (message = 'La fecha no es válida.') =>
  z.union([z.iso.datetime({ offset: true }), z.iso.date()], { error: message }).transform((s) => new Date(s));

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
