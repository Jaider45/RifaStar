import { z, ZodIssueCode } from 'zod';

/** Mensajes de validación de zod en español, aptos para mostrar al usuario. */
export const spanishErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case ZodIssueCode.invalid_type:
      if (issue.received === 'undefined' || issue.received === 'null') return { message: 'Este campo es obligatorio.' };
      return { message: 'El valor no tiene el formato esperado.' };
    case ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: `Debe tener al menos ${issue.minimum} caracteres.` };
      if (issue.type === 'array') return { message: `Elige al menos ${issue.minimum}.` };
      return { message: `Debe ser mayor o igual a ${issue.minimum}.` };
    case ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Debe tener como máximo ${issue.maximum} caracteres.` };
      if (issue.type === 'array') return { message: `Puedes elegir como máximo ${issue.maximum}.` };
      return { message: `Debe ser menor o igual a ${issue.maximum}.` };
    case ZodIssueCode.invalid_enum_value:
    case ZodIssueCode.invalid_literal:
    case ZodIssueCode.invalid_union:
      return { message: 'El valor no es una opción válida.' };
    case ZodIssueCode.invalid_string:
      return { message: 'El texto no tiene el formato esperado.' };
    case ZodIssueCode.invalid_date:
      return { message: 'La fecha no es válida.' };
    case ZodIssueCode.unrecognized_keys:
      return { message: `Campos no permitidos: ${issue.keys.join(', ')}.` };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(spanishErrorMap);
