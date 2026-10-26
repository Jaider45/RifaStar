import type { ExtraDigitsPosition, ExtraDigitsSource, PrizeRule } from '@prisma/client';

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
 *   5 cifras: full_number = ABCD + S (o S + ABCD), con S = última cifra de la serie
 *             o la quinta cifra del chance, según la configuración del sorteo
 *   6 cifras: full_number = ABCD + SS (o SS + ABCD), con SS = dos últimas de la serie
 *   custom:   lo ingresa el organizador (no se calcula)
 */

export type Digits = 2 | 3 | 4 | 5 | 6;

export const RESULT_RE = /^\d{4}$/;
export const SERIES_RE = /^\d{3}$/;
export const FIFTH_DIGIT_RE = /^\d$/;

export class WinnerRuleError extends Error {}

/** Cómo completa un sorteo de 5 o 6 cifras las 4 cifras de la lotería. */
export interface ExtraDigitsConfig {
  source: ExtraDigitsSource | null;
  position: ExtraDigitsPosition;
}

/** Datos del resultado que completan las cifras extra. */
export interface ExtraResult {
  series?: string | null;
  fifthDigit?: string | null;
}

const RULE_DIGITS: Record<Exclude<PrizeRule, 'custom'>, readonly Digits[]> = {
  last_two: [2],
  first_two: [2],
  middle_two: [2],
  digits_1_and_4: [2],
  anticipated_last_two: [2],
  last_three: [3],
  first_three: [3],
  full_number: [4, 5, 6],
  anticipated_full_number: [3, 4],
};

export function ruleAppliesTo(rule: PrizeRule, digits: Digits): boolean {
  return rule === 'custom' || RULE_DIGITS[rule].includes(digits);
}

export function needsAnticipated(rule: PrizeRule): boolean {
  return rule === 'anticipated_last_two' || rule === 'anticipated_full_number';
}

/** Fuentes válidas para completar las cifras: 5 cifras admite serie o quinta cifra; 6, solo serie. */
export function validExtraSources(digits: Digits): readonly ExtraDigitsSource[] {
  if (digits === 5) return ['series', 'fifth_digit'];
  if (digits === 6) return ['series'];
  return [];
}

/** Qué dato adicional del resultado necesita el sorteo (null si le bastan las 4 cifras). */
export function extraResultField(digits: Digits, config: ExtraDigitsConfig): 'series' | 'fifthDigit' | null {
  if (digits <= 4) return null;
  return config.source === 'fifth_digit' ? 'fifthDigit' : 'series';
}

/**
 * Arma el número completo de un sorteo de 5 o 6 cifras. Ejemplo con 4058, serie 127:
 * 5 cifras al final → 40587 · al inicio → 74058 · 6 cifras al final → 405827.
 */
export function composeFullNumber(digits: Digits, mainResult: string, config: ExtraDigitsConfig, extra: ExtraResult): string {
  if (digits <= 4) return mainResult;
  const missing = digits - 4;
  let tail: string;
  if (config.source === 'fifth_digit') {
    if (digits !== 5) throw new WinnerRuleError('La quinta cifra del chance solo completa sorteos de 5 cifras.');
    if (!extra.fifthDigit || !FIFTH_DIGIT_RE.test(extra.fifthDigit)) throw new WinnerRuleError('Falta la quinta cifra del chance.');
    tail = extra.fifthDigit;
  } else if (config.source === 'series') {
    if (!extra.series || !SERIES_RE.test(extra.series)) throw new WinnerRuleError('Falta la serie de la lotería (3 dígitos).');
    tail = extra.series.slice(3 - missing);
  } else {
    throw new WinnerRuleError(`El sorteo de ${digits} cifras no tiene definida la fuente de las cifras que faltan.`);
  }
  return config.position === 'start' ? tail + mainResult : mainResult + tail;
}

/**
 * Devuelve el número ganador (0 … 10^digits − 1), o `null` si la regla es
 * `custom` o si es un anticipado y todavía no hay resultado del anticipado.
 */
export function winningNumber(
  rule: PrizeRule,
  digits: Digits,
  mainResult: string,
  anticipatedResult?: string | null,
  extra: { config: ExtraDigitsConfig; result: ExtraResult } = { config: { source: null, position: 'end' }, result: {} },
): number | null {
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
      return pick(composeFullNumber(digits, mainResult, extra.config, extra.result));
    case 'anticipated_last_two':
      return anticipatedResult ? pick(anticipatedResult.slice(2)) : null;
    case 'anticipated_full_number':
      return anticipatedResult ? pick(anticipatedResult.slice(4 - digits)) : null;
  }
}
