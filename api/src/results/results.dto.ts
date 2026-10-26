import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '../common/zod';

const zResult = z.string().trim().regex(/^\d{4}$/, 'El resultado tiene 4 dígitos (por ejemplo 0507).');

export class EnterResultDto extends createZodDto(
  z.object({
    mainResult: zResult,
    anticipatedResult: zResult.nullable().optional(),
    /** Serie de la lotería (3 dígitos): la necesitan los sorteos de 5 y 6 cifras que juegan con la serie. */
    seriesResult: z.string().trim().regex(/^\d{3}$/, 'La serie tiene 3 dígitos (por ejemplo 027).').nullable().optional(),
    /** Quinta cifra del chance: la necesitan los sorteos de 5 cifras que juegan con ella. */
    fifthDigit: z.string().trim().regex(/^\d$/, 'La quinta cifra es un solo dígito.').nullable().optional(),
    customWinners: z
      .array(z.object({ prizeId: zUuid, number: z.number().int().min(0).max(999_999) }))
      .max(20)
      .optional(),
    /** Código de la app de autenticación: el resultado define quién gana y se confirma en el momento. */
    totpCode: z.string().trim().regex(/^\d{6}$/, 'Escribe el código de 6 dígitos de tu app de autenticación.'),
  }),
) {}

export class DeliverDto extends createZodDto(z.object({ note: z.string().trim().max(300).optional() })) {}
