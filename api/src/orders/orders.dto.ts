import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zCursorQuery, zUuid } from '../common/zod';

export const ReserveInput = z
  .object({
    name: z.string().trim().min(2, 'Escribe tu nombre.').max(80),
    phone: z.string().trim().min(7, 'Escribe tu número de WhatsApp.').max(20),
    numbers: z
      .array(z.number().int().min(0).max(999_999))
      .min(1)
      .max(500)
      .refine((a) => new Set(a).size === a.length, 'Hay números repetidos.')
      .optional(),
    random: z.number().int().min(1).max(500).optional(),
    sellerCode: z.string().trim().max(20).optional(),
    nickname: z.string().trim().min(2).max(30).optional(),
    referralCode: z.string().trim().max(20).optional(),
  })
  .refine((v) => (v.numbers ? 1 : 0) + (v.random ? 1 : 0) === 1, {
    message: 'Elige números o pide números al azar (solo una de las dos).',
    path: ['numbers'],
  });
export type ReserveInput = z.infer<typeof ReserveInput>;
export class ReserveDto extends createZodDto(ReserveInput) {}

export class ReceiptRequestDto extends createZodDto(
  z.object({ contentType: z.string().max(100), size: z.number().int().positive() }),
) {}
export class ReceiptConfirmDto extends createZodDto(z.object({ key: z.string().min(5).max(300).optional() })) {}

export class ReasonDto extends createZodDto(z.object({ reason: z.string().trim().min(3, 'Escribe el motivo.').max(300) })) {}

export class QueueQuery extends createZodDto(z.object({ raffleId: zUuid.optional() })) {}

export class ListOrdersQuery extends createZodDto(
  zCursorQuery.extend({
    raffleId: zUuid.optional(),
    status: z.enum(['reserved', 'pending_verification', 'approved', 'rejected', 'expired', 'released']).optional(),
    sellerMemberId: zUuid.optional(),
    q: z.string().trim().max(80).optional(),
  }),
) {}

export class SalesQuery extends createZodDto(
  z.object({ raffleId: zUuid.optional(), from: z.coerce.date().optional(), to: z.coerce.date().optional() }),
) {}
