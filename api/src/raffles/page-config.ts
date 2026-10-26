import { z } from 'zod';

/**
 * Personalización de la página pública de un sorteo. Se guarda en `raffles.page_config`
 * y se valida siempre al leer, así que los datos viejos reciben los valores por defecto.
 * El logo y la letra de Rifa Star no se cambian: la marca se mantiene.
 */
export const PageConfig = z
  .object({
    /** Oscuro es la cara de la marca; claro para quien lo prefiera. */
    theme: z.enum(['dark', 'light']).default('dark'),
    /**
     * Descripción con formato básico: **negrita**, *cursiva*, listas con «- » y enlaces
     * [texto](https://…). Se guarda como texto y el frontend la interpreta sin HTML.
     */
    description: z.string().trim().max(2000).nullable().default(null),
    faq: z
      .array(z.object({ q: z.string().trim().min(3).max(150), a: z.string().trim().min(2).max(600) }))
      .max(12)
      .default([]),
    /** Secciones visibles en la página pública. */
    show: z
      .object({
        countdown: z.boolean().default(true),
        progress: z.boolean().default(true),
        remaining: z.boolean().default(true),
        organizer: z.boolean().default(true),
        ranking: z.boolean().default(true),
        social: z.boolean().default(true),
      })
      .default({}),
  })
  .strict();

export type PageConfig = z.infer<typeof PageConfig>;

/** Lee el JSON guardado; si algo no valida (dato antiguo o corrupto) usa los valores por defecto. */
export function readPageConfig(raw: unknown): PageConfig {
  const parsed = PageConfig.safeParse(raw ?? {});
  return parsed.success ? parsed.data : PageConfig.parse({});
}
