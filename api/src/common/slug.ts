/** «Gana con Boyacá · 24 oct» → «gana-con-boyaca-24-oct». */
export function slugify(input: string, maxLength = 60): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
}

/** Slugs que no puede tomar una organización (colisionan con rutas del producto). */
export const RESERVED_ORG_SLUGS = new Set([
  'admin', 'api', 'app', 'plataforma', 'platform', 'v1', 's', 'r', 'mis-boletos', 'login',
  'registro', 'signup', 'ayuda', 'soporte', 'support', 'static', 'assets', 'www', 'rifastar',
  'invitacion', 'olvide', 'restablecer', 'salir', 'ranking',
]);
