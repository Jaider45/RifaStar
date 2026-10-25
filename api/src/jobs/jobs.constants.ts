export const MAINTENANCE_QUEUE = 'maintenance';
export const MESSAGES_QUEUE = 'messages';

export const JOB = {
  expireReservations: 'expire-reservations',
  closeSales: 'close-sales',
  closeSalesSweep: 'close-sales-sweep',
  drawReminder: 'draw-reminder',
  rankingRollover: 'ranking-rollover',
  dailyDigest: 'daily-digest',
  billingSync: 'billing-sync',
  sendWhatsapp: 'send-whatsapp',
} as const;
