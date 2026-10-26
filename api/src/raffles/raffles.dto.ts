import { ExtraDigitsPosition, ExtraDigitsSource, NumberSelection, PrizeRule } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zHexColor, zUuid } from '../common/zod';
import { type Digits, validExtraSources } from '../results/winner-rules';
import { PageConfig } from './page-config';
import { ANTICIPATED_RULES } from './prize-rules';

const zDate = z.coerce.date({ invalid_type_error: 'La fecha no es válida.' });
/** Identificadores de LoteríaYa: `loteria-de-boyaca`, `antioquenita-tarde`. */
const zDrawCode = z.string().trim().toLowerCase().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'El identificador de la lotería no es válido.').max(60);

export const PrizeInput = z
  .object({
    amountCop: z.number().int().positive().max(10_000_000_000).optional(),
    description: z.string().trim().min(2).max(200).optional(),
    rule: z.nativeEnum(PrizeRule),
    customRuleText: z.string().trim().min(3).max(200).optional(),
    anticipatedLottery: z.string().trim().min(2).max(80).optional(),
    /** Identificador del anticipado en LoteríaYa (`antioquenita-tarde`): sirve para avisar su resultado. */
    anticipatedDrawCode: zDrawCode.nullable().optional(),
    anticipatedDrawAt: zDate.optional(),
    /** Foto del premio (key devuelta por POST /raffles/:id/media/prize/confirm). */
    imageKey: z.string().max(300).nullable().optional(),
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
  /** Identificador en LoteríaYa. null = sorteo propio (sin aviso automático del resultado). */
  lotteryDrawCode: zDrawCode.nullable().optional(),
  drawAt: zDate,
  salesCloseAt: zDate.nullable().optional(),
  pricePerNumber: z.number().int().min(100, 'El precio mínimo es $100.').max(100_000_000),
  digits: z.union([z.literal(2), z.literal(3), z.literal(4), z.literal(5), z.literal(6)]),
  /** Compra mínima por participante en este sorteo. */
  minPerOrder: z.number().int().min(1).max(500).default(1),
  numberSelection: z.nativeEnum(NumberSelection).default('choose'),
  extraDigitsSource: z.nativeEnum(ExtraDigitsSource).nullable().optional(),
  extraDigitsPosition: z.nativeEnum(ExtraDigitsPosition).default('end'),
  accentColor: zHexColor.nullable().optional(),
  conditionText: z.string().trim().max(500).nullable().optional(),
  authorizationNumber: z.string().trim().max(60).nullable().optional(),
  pageConfig: PageConfig.optional(),
  /** Fotos adicionales (keys devueltas por POST /raffles/:id/media/gallery/confirm), en orden. */
  galleryKeys: z.array(z.string().max(300)).max(6).optional(),
  prizes: z.array(PrizeInput).max(20).default([]),
  paymentAccountIds: z.array(zUuid).max(10).optional(),
});

/**
 * 5 y 6 cifras necesitan saber de dónde salen las cifras que faltan; 2 a 4 no.
 * Devuelve el mensaje del problema, o null si la combinación es válida.
 */
export function extraDigitsIssue(digits: number, source: ExtraDigitsSource | null | undefined): string | null {
  const valid = validExtraSources(digits as Digits);
  if (valid.length === 0) return source ? `Los sorteos de ${digits} cifras juegan solo con la lotería.` : null;
  if (source && valid.includes(source)) return null;
  return digits === 6
    ? 'Los sorteos de 6 cifras completan el número con las dos últimas cifras de la serie.'
    : 'Elige cómo se completa la quinta cifra: con la serie de la lotería o con la quinta cifra del chance.';
}

export class CreateRaffleDto extends createZodDto(
  RaffleFields.superRefine((v, ctx) => {
    const issue = extraDigitsIssue(v.digits, v.extraDigitsSource);
    if (issue) ctx.addIssue({ code: 'custom', path: ['extraDigitsSource'], message: issue });
  }),
) {}
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
/** Fotos de la página pública: galería del sorteo o foto de un premio. */
export const MEDIA_KINDS = { gallery: 'gallery', prize: 'prize' } as const;
export type MediaKind = keyof typeof MEDIA_KINDS;
