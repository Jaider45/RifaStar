import { HttpStatus } from '@nestjs/common';

/**
 * Error de dominio con el formato único de la API: { code, message, details }.
 * `message` va en español y se puede mostrar tal cual al usuario.
 */
export class AppError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

const e = (code: string, status: number, message: string) => (details?: unknown) =>
  new AppError(code, status, message, details);

export const Errors = {
  validation: (details?: unknown, message = 'Revisa los datos enviados.') =>
    new AppError('VALIDATION_ERROR', HttpStatus.BAD_REQUEST, message, details),
  authRequired: e('AUTH_REQUIRED', 401, 'Inicia sesión para continuar.'),
  invalidCredentials: e('AUTH_INVALID_CREDENTIALS', 401, 'El correo o la contraseña no son correctos.'),
  twoFactorRequired: e('AUTH_2FA_REQUIRED', 401, 'Ingresa el código de verificación de tu app de autenticación.'),
  twoFactorInvalid: e('AUTH_2FA_INVALID', 401, 'El código de verificación no es válido o ya venció.'),
  sessionExpired: e('AUTH_SESSION_EXPIRED', 401, 'Tu sesión venció. Vuelve a iniciar sesión.'),
  twoFactorSetupRequired: e(
    'AUTH_2FA_SETUP_REQUIRED',
    403,
    'Para aprobar pagos, anunciar ganadores o manejar el equipo debes activar la verificación en dos pasos en Ajustes › Seguridad.',
  ),
  forbidden: e('FORBIDDEN_PERMISSION', 403, 'No tienes permiso para hacer esto.'),
  selfApproval: e('SELF_APPROVAL', 403, 'No puedes aprobar ni rechazar un pago de una venta que hiciste tú. Pídele a otra persona del equipo.'),
  notMember: e('FORBIDDEN_PERMISSION', 403, 'No perteneces a esta organización.'),
  supportReadOnly: e('SUPPORT_READ_ONLY', 403, 'Estás en modo soporte: solo puedes consultar, no hacer cambios.'),
  orgSuspended: e('ORG_SUSPENDED', 403, 'La cuenta está suspendida. Actualiza el pago para volver a hacer cambios.'),
  orgRequired: e('ORG_REQUIRED', 400, 'Indica la organización con la cabecera X-Organization-Id.'),
  notFound: (what = 'el recurso') => new AppError('NOT_FOUND', 404, `No encontramos ${what}.`),
  conflict: (code: string, message: string, details?: unknown) => new AppError(code, 409, message, details),
  emailTaken: e('EMAIL_TAKEN', 409, 'Ya existe una cuenta con ese correo.'),
  slugTaken: e('SLUG_TAKEN', 409, 'Esa dirección ya está en uso. Prueba con otra.'),
  lastOwner: e('LAST_OWNER', 409, 'La organización debe tener al menos un propietario.'),
  revisionConflict: e('REVISION_CONFLICT', 409, 'Alguien más cambió estos datos. Recarga y vuelve a intentar.'),
  rateLimited: e('RATE_LIMITED', 429, 'Hiciste demasiados intentos. Espera un momento y vuelve a intentar.'),
  planLimit: (code: string, message: string, details?: unknown) => new AppError(code, 402, message, details),
  internal: e('INTERNAL', 500, 'Algo salió mal de nuestro lado. Intenta de nuevo en unos minutos.'),
};
