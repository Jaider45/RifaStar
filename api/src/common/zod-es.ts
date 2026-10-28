import { z } from 'zod';

/**
 * Mensajes de validación de zod en español, aptos para mostrar al usuario. Se usan cuando el
 * esquema no trae su propio mensaje; si se devuelve `undefined`, queda el de zod.
 */
export const spanishErrorMap: z.core.$ZodErrorMap = (issue) => {
  switch (issue.code) {
    case 'invalid_type':
      if (issue.input === undefined || issue.input === null) return 'Este campo es obligatorio.';
      if (issue.expected === 'date') return 'La fecha no es válida.';
      return 'El valor no tiene el formato esperado.';
    case 'too_small':
      if (issue.origin === 'string') return `Debe tener al menos ${issue.minimum} caracteres.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Elige al menos ${issue.minimum}.`;
      return `Debe ser mayor o igual a ${issue.minimum}.`;
    case 'too_big':
      if (issue.origin === 'string') return `Debe tener como máximo ${issue.maximum} caracteres.`;
      if (issue.origin === 'array' || issue.origin === 'set') return `Puedes elegir como máximo ${issue.maximum}.`;
      return `Debe ser menor o igual a ${issue.maximum}.`;
    case 'invalid_value':
    case 'invalid_union':
      return 'El valor no es una opción válida.';
    case 'invalid_format':
      return 'El texto no tiene el formato esperado.';
    case 'unrecognized_keys':
      return `Campos no permitidos: ${issue.keys.join(', ')}.`;
    default:
      return undefined;
  }
};

z.config({ customError: spanishErrorMap });
