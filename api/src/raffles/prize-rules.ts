import { PrizeRule } from '@prisma/client';
import { ruleAppliesTo } from '../results/winner-rules';

const ALL_RULES = Object.values(PrizeRule);

/** Reglas permitidas según las cifras del sorteo (P3), derivadas del módulo de ganadores. */
export const RULES_BY_DIGITS: Record<2 | 3 | 4 | 5 | 6, readonly PrizeRule[]> = {
  2: ALL_RULES.filter((r) => ruleAppliesTo(r, 2)),
  3: ALL_RULES.filter((r) => ruleAppliesTo(r, 3)),
  4: ALL_RULES.filter((r) => ruleAppliesTo(r, 4)),
  5: ALL_RULES.filter((r) => ruleAppliesTo(r, 5)),
  6: ALL_RULES.filter((r) => ruleAppliesTo(r, 6)),
};

export const ANTICIPATED_RULES: ReadonlySet<PrizeRule> = new Set(['anticipated_last_two', 'anticipated_full_number']);

const BASE_LABELS: Record<Exclude<PrizeRule, 'custom'>, string> = {
  last_two: 'Dos últimas cifras',
  first_two: 'Dos primeras cifras',
  middle_two: 'Dos del medio',
  digits_1_and_4: 'Dígito #1 y #4',
  anticipated_last_two: 'Anticipado (dos últimas cifras)',
  last_three: 'Tres últimas cifras',
  first_three: 'Tres primeras cifras',
  full_number: 'Número completo',
  anticipated_full_number: 'Anticipado (número completo)',
};

/** Nombre de la regla para mostrarle al organizador («Dos últimas cifras»). */
export const ruleName = (rule: PrizeRule) => (rule === 'custom' ? 'Regla especial' : BASE_LABELS[rule]);

export interface PrizeLike {
  rule: PrizeRule;
  customRuleText: string | null;
  anticipatedLottery: string | null;
  anticipatedDrawAt: Date | null;
}

/** Texto de la regla para mostrar: «Anticipado con Antioqueñita 4:00 p. m. (dos últimas cifras)». */
export function prizeRuleLabel(prize: PrizeLike, timezone: string): string {
  if (prize.rule === 'custom') return prize.customRuleText ?? 'Regla especial';
  if (ANTICIPATED_RULES.has(prize.rule)) {
    const time = prize.anticipatedDrawAt
      ? ' ' +
        new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: timezone })
          .format(prize.anticipatedDrawAt)
          .replace(/[\s\u00a0\u202f]+/g, ' ')
      : '';
    const scope = prize.rule === 'anticipated_last_two' ? 'dos últimas cifras' : 'número completo';
    return `Anticipado con ${prize.anticipatedLottery ?? 'lotería'}${time} (${scope})`;
  }
  return BASE_LABELS[prize.rule];
}
