import type { PrizeRule } from '@prisma/client';

/**
 * Cálculo puro del número ganador de cada premio (regla 5 y P3: coincidencia
 * exacta, sin aproximaciones). El resultado de la lotería tiene 4 dígitos
 * «ABCD» y se maneja como texto para conservar los ceros a la izquierda.
 *
 *   2 cifras: last_two = CD · first_two = AB · middle_two = BC ·
 *             digits_1_and_4 = AD · anticipated_last_two = 2 últimas del anticipado
 *   3 cifras: last_three = BCD · first_three = ABC ·
 *             anticipated_full_number = 3 últimas del anticipado
 *   4 cifras: full_number = ABCD · anticipated_full_number = el anticipado completo
 *   custom:   lo ingresa el organizador (no se calcula)
 */

export type Digits = 2 | 3 | 4;

export const RESULT_RE = /^\d{4}$/;

export class WinnerRuleError extends Error {}

const RULE_DIGITS: Record<Exclude<PrizeRule, 'custom'>, readonly Digits[]> = {
  last_two: [2],
  first_two: [2],
  middle_two: [2],
  digits_1_and_4: [2],
  anticipated_last_two: [2],
  last_three: [3],
  first_three: [3],
  full_number: [4],
  anticipated_full_number: [3, 4],
};

export function ruleAppliesTo(rule: PrizeRule, digits: Digits): boolean {
  return rule === 'custom' || RULE_DIGITS[rule].includes(digits);
}

export function needsAnticipated(rule: PrizeRule): boolean {
  return rule === 'anticipated_last_two' || rule === 'anticipated_full_number';
}

/**
 * Devuelve el número ganador (0 … 10^digits − 1), o `null` si la regla es
 * `custom` o si es un anticipado y todavía no hay resultado del anticipado.
 */
export function winningNumber(rule: PrizeRule, digits: Digits, mainResult: string, anticipatedResult?: string | null): number | null {
  if (!RESULT_RE.test(mainResult)) throw new WinnerRuleError('El resultado debe tener 4 dígitos.');
  if (anticipatedResult != null && !RESULT_RE.test(anticipatedResult)) {
    throw new WinnerRuleError('El resultado del anticipado debe tener 4 dígitos.');
  }
  if (rule === 'custom') return null;
  if (!ruleAppliesTo(rule, digits)) throw new WinnerRuleError(`La regla ${rule} no aplica a sorteos de ${digits} cifras.`);

  const [a, b, c, d] = mainResult;
  const pick = (s: string) => Number.parseInt(s, 10);
  switch (rule) {
    case 'last_two':
      return pick(c + d);
    case 'first_two':
      return pick(a + b);
    case 'middle_two':
      return pick(b + c);
    case 'digits_1_and_4':
      return pick(a + d);
    case 'last_three':
      return pick(b + c + d);
    case 'first_three':
      return pick(a + b + c);
    case 'full_number':
      return pick(mainResult);
    case 'anticipated_last_two':
      return anticipatedResult ? pick(anticipatedResult.slice(2)) : null;
    case 'anticipated_full_number':
      return anticipatedResult ? pick(anticipatedResult.slice(4 - digits)) : null;
  }
}
