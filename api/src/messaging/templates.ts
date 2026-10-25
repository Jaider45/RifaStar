import type { NotificationsSettings } from '../settings/schemas';

/**
 * Plantillas de WhatsApp. Cada una corresponde a una plantilla aprobada en
 * Meta (nombre `meta`, idioma es) con los parámetros en el orden indicado.
 *
 * `kind` (P6): las transaccionales siempre se envían (pueden pasarse de la
 * cuota); las automáticas/promocionales se omiten si la cuota se agotó.
 */
export interface TemplateDef<V> {
  meta: string;
  kind: 'transactional' | 'promotional';
  /** Ajuste de notificaciones que la activa (si aplica). */
  setting?: keyof NotificationsSettings;
  params: (v: V) => string[];
  preview: (v: V) => string;
}

const def = <V>(d: TemplateDef<V>) => d;

export const TEMPLATES = {
  otp_code: def<{ code: string; org: string }>({
    meta: 'rs_otp_code',
    kind: 'transactional',
    params: (v) => [v.code, v.org],
    preview: (v) => `Tu código para ver tus boletos de ${v.org} es ${v.code}. Vence en 10 minutos. No lo compartas.`,
  }),
  ticket_confirmed: def<{ name: string; raffle: string; numbers: string; codes: string; drawAt: string }>({
    meta: 'rs_ticket_confirmed',
    kind: 'transactional',
    setting: 'purchaseConfirmation',
    params: (v) => [v.name, v.raffle, v.numbers, v.codes, v.drawAt],
    preview: (v) =>
      `¡Hola, ${v.name}! Tu pago en «${v.raffle}» quedó aprobado. Números: ${v.numbers}. Boletos: ${v.codes}. Juega ${v.drawAt}. ¡Mucha suerte!`,
  }),
  payment_rejected: def<{ name: string; raffle: string; reason: string }>({
    meta: 'rs_payment_rejected',
    kind: 'transactional',
    params: (v) => [v.name, v.raffle, v.reason],
    preview: (v) => `Hola, ${v.name}. No pudimos aprobar tu pago en «${v.raffle}»: ${v.reason}. Tus números quedaron libres.`,
  }),
  raffle_cancelled: def<{ name: string; raffle: string; reason: string }>({
    meta: 'rs_raffle_cancelled',
    kind: 'transactional',
    params: (v) => [v.name, v.raffle, v.reason],
    preview: (v) => `Hola, ${v.name}. El sorteo «${v.raffle}» fue cancelado: ${v.reason}. El organizador te contactará por tu reembolso.`,
  }),
  winner_notice: def<{ name: string; raffle: string; number: string; prize: string }>({
    meta: 'rs_winner_notice',
    kind: 'transactional',
    params: (v) => [v.name, v.raffle, v.number, v.prize],
    preview: (v) => `¡Felicidades, ${v.name}! Con el número ${v.number} ganaste «${v.prize}» en «${v.raffle}».`,
  }),
  draw_reminder: def<{ name: string; raffle: string; time: string; numbers: string }>({
    meta: 'rs_draw_reminder',
    kind: 'promotional',
    setting: 'drawReminder',
    params: (v) => [v.name, v.raffle, v.time, v.numbers],
    preview: (v) => `${v.name}, «${v.raffle}» juega hoy a las ${v.time}. Tus números: ${v.numbers}. ¡Suerte!`,
  }),
  new_raffle: def<{ name: string; org: string; raffle: string; link: string }>({
    meta: 'rs_new_raffle',
    kind: 'promotional',
    setting: 'newRaffleNotice',
    params: (v) => [v.name, v.org, v.raffle, v.link],
    preview: (v) => `${v.name}, ${v.org} abrió «${v.raffle}». Elige tus números aquí: ${v.link}`,
  }),
  ranking_top10: def<{ org: string; period: string; top: string }>({
    meta: 'rs_ranking_top10',
    kind: 'promotional',
    params: (v) => [v.org, v.period, v.top],
    preview: (v) => `Top 10 de ${v.org} (${v.period}): ${v.top}`,
  }),
  daily_digest: def<{ org: string; date: string; collected: string; approved: string; pending: string }>({
    meta: 'rs_daily_digest',
    kind: 'promotional',
    setting: 'dailyDigest',
    params: (v) => [v.org, v.date, v.collected, v.approved, v.pending],
    preview: (v) => `Resumen de ${v.org} (${v.date}): recaudo ${v.collected}, ${v.approved} pagos aprobados, ${v.pending} por verificar.`,
  }),
};

export type TemplateKey = keyof typeof TEMPLATES;
export type TemplateVars<K extends TemplateKey> = Parameters<(typeof TEMPLATES)[K]['params']>[0];
