import { PrizeRule } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zHexColor, zUuid } from '../common/zod';
import { ANTICIPATED_RULES } from './prize-rules';

const zDate = z.coerce.date({ invalid_type_error: 'La fecha no es válida.' });

export const PrizeInput = z
  .object({
    amountCop: z.number().int().positive().max(10_000_000_000).optional(),
    description: z.string().trim().min(2).max(200).optional(),
    rule: z.nativeEnum(PrizeRule),
    customRuleText: z.string().trim().min(3).max(200).optional(),
    anticipatedLottery: z.string().trim().min(2).max(80).optional(),
    anticipatedDrawAt: zDate.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.amountCop === undefined && !p.description) {
      ctx.addIssue({ code: 'custom', path: ['amountCop'], message: 'Indica el monto o la descripción del premio.' });
    }
    if (p.rule === 'custom' && !p.customRuleText) {
      ctx.addIssue({ code: 'custom', path: ['customRuleText'], message: 'Explica cómo se gana este premio.' });
    }
    if (ANTICIPATED_RULES.has(p.rule) && !p.anticipatedLottery) {
      ctx.addIssue({ code: 'custom', path: ['anticipatedLottery'], message: 'Indica con qué lotería juega el anticipado.' });
    }
  });
export type PrizeInput = z.infer<typeof PrizeInput>;

const slug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](-?[a-z0-9])+$/, 'Usa solo letras minúsculas, números y guiones.')
  .max(60);

const RaffleFields = z.object({
  title: z.string().trim().min(3).max(120),
  slug: slug.optional(),
  lottery: z.string().trim().min(2).max(80),
  drawAt: zDate,
  salesCloseAt: zDate.nullable().optional(),
  pricePerNumber: z.number().int().min(100, 'El precio mínimo es $100.').max(100_000_000),
  digits: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  minPerOrder: z.number().int().min(1).max(500).default(1),
  accentColor: zHexColor.nullable().optional(),
  conditionText: z.string().trim().max(500).nullable().optional(),
  authorizationNumber: z.string().trim().max(60).nullable().optional(),
  prizes: z.array(PrizeInput).max(20).default([]),
  paymentAccountIds: z.array(zUuid).max(10).optional(),
});

export class CreateRaffleDto extends createZodDto(RaffleFields) {}
export class UpdateRaffleDto extends createZodDto(RaffleFields.partial().omit({ prizes: true })) {}
export class ReplacePrizesDto extends createZodDto(z.object({ prizes: z.array(PrizeInput).max(20) })) {}
export class DuplicateRaffleDto extends createZodDto(
  z.object({ title: z.string().trim().min(3).max(120).optional(), drawAt: zDate.optional() }),
) {}
export class CancelRaffleDto extends createZodDto(z.object({ reason: z.string().trim().min(3).max(300) })) {}
export class ListRafflesQuery extends createZodDto(
  z.object({
    status: z.enum(['draft', 'active', 'sold_out', 'closed', 'drawn', 'cancelled']).optional(),
    q: z.string().trim().max(80).optional(),
  }),
) {}
export class UploadRequestDto extends createZodDto(
  z.object({ contentType: z.string().max(100), size: z.number().int().positive() }),
) {}
export class UploadConfirmDto extends createZodDto(z.object({ key: z.string().min(5).max(300) })) {}
