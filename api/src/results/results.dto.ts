import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '../common/zod';

const zResult = z.string().trim().regex(/^\d{4}$/, 'El resultado tiene 4 dígitos (por ejemplo 0507).');

export class EnterResultDto extends createZodDto(
  z.object({
    mainResult: zResult,
    anticipatedResult: zResult.nullable().optional(),
    customWinners: z
      .array(z.object({ prizeId: zUuid, number: z.number().int().min(0).max(9999) }))
      .max(20)
      .optional(),
  }),
) {}

export class DeliverDto extends createZodDto(z.object({ note: z.string().trim().max(300).optional() })) {}
