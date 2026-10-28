import type { SettingsSection } from '@prisma/client';
import { z } from 'zod';

/**
 * Esquemas versionados de cada sección de OrgSettings. Al cambiar la forma de
 * una sección se agrega una versión nueva y una función de migración en
 * `SETTINGS_MIGRATIONS`; las filas viejas se actualizan al leerlas.
 */
export const PaymentsSettingsV1 = z.object({
  reservationMinutes: z.union([z.literal(30), z.literal(60), z.literal(120)]).default(30),
  requireReceipt: z.boolean().default(true),
  /** Antibots: máximo de números apartados sin pagar por teléfono y sorteo (0 = sin límite). */
  maxHeldPerPhone: z.number().int().min(0).max(1000).default(100),
});

export const RankingSettingsV1 = z.object({
  enabled: z.boolean().default(false),
  pointsPerNumber: z.number().int().min(1).max(100).default(1),
  consistencyBonus: z
    .object({
      enabled: z.boolean().default(false),
      minRaffles: z.number().int().min(2).max(50).default(4),
      points: z.number().int().min(1).max(1000).default(5),
    })
    .default({}),
  referralBonus: z
    .object({
      enabled: z.boolean().default(false),
      points: z.number().int().min(1).max(1000).default(3),
    })
    .default({}),
  frequency: z.enum(['monthly', 'biweekly', 'weekly']).default('monthly'),
  /** Solo semanal: 1 = lunes … 7 = domingo (ISO). */
  weeklyResetDay: z.number().int().min(1).max(7).default(1),
  tiebreaker: z.enum(['first_to_reach', 'most_raffles']).default('first_to_reach'),
  publicTopSize: z.union([z.literal(10), z.literal(20), z.literal(50)]).default(10),
  nameFormat: z.enum(['first_name_initial', 'initials', 'nickname']).default('first_name_initial'),
  prizes: z.array(z.string().trim().min(1).max(120)).max(10).default([]),
  announceOnClose: z.boolean().default(false),
});

export const NotificationsSettingsV1 = z.object({
  purchaseConfirmation: z.boolean().default(true),
  drawReminder: z.boolean().default(true),
  newRaffleNotice: z.boolean().default(false),
  dailyDigest: z.boolean().default(false),
  /** Avisar a los gestores (WhatsApp y correo) del resultado de LoteríaYa y de los ganadores. */
  managerAlerts: z.boolean().default(true),
  /** Recordar a los gestores los premios sin marcar como entregados. */
  deliveryReminder: z.boolean().default(false),
  deliveryReminderHours: z.number().int().min(6).max(240).default(48),
});

const socialUrl = (host: RegExp) =>
  z
    .string()
    .trim()
    .max(200)
    .url('Escribe el enlace completo (https://…).')
    .refine((u) => u.startsWith('https://') && host.test(new URL(u).hostname), 'Ese enlace no es de la red social indicada.')
    .nullable()
    .default(null);

export const BrandingSettingsV1 = z.object({
  hideRifaStarBadge: z.boolean().default(false),
  /** Redes del organizador en la página pública. */
  instagramUrl: socialUrl(/(^|\.)instagram\.com$/),
  facebookUrl: socialUrl(/(^|\.)(facebook|fb)\.com$/),
  tiktokUrl: socialUrl(/(^|\.)tiktok\.com$/),
});

export const ReceiptsSettingsV1 = z.object({
  issuerName: z.string().trim().max(120).default(''),
  taxId: z.string().trim().max(40).default(''),
  address: z.string().trim().max(180).default(''),
  phone: z.string().trim().max(30).default(''),
  email: z.union([z.string().trim().email().max(120), z.literal('')]).default(''),
  conceptTemplate: z.string().trim().min(1).max(180).default('{cantidad} {concepto} para el sorteo {sorteo}'),
  unitLabel: z.string().trim().min(1).max(32).default('números'),
  footer: z.string().trim().max(300).default('Gracias por tu compra.'),
});

export const SETTINGS_SCHEMAS = {
  payments: PaymentsSettingsV1,
  ranking: RankingSettingsV1,
  notifications: NotificationsSettingsV1,
  branding: BrandingSettingsV1,
  receipts: ReceiptsSettingsV1,
} satisfies Record<SettingsSection, z.ZodTypeAny>;

export const CURRENT_SETTINGS_VERSION: Record<SettingsSection, number> = {
  payments: 1,
  ranking: 1,
  notifications: 1,
  branding: 1,
  receipts: 1,
};

/** Migraciones entre versiones: `{ section: { fromVersion: (data) => dataSiguiente } }`. */
export const SETTINGS_MIGRATIONS: Partial<Record<SettingsSection, Record<number, (data: unknown) => unknown>>> = {};

export type PaymentsSettings = z.infer<typeof PaymentsSettingsV1>;
export type RankingSettings = z.infer<typeof RankingSettingsV1>;
export type NotificationsSettings = z.infer<typeof NotificationsSettingsV1>;
export type BrandingSettings = z.infer<typeof BrandingSettingsV1>;
export type ReceiptsSettings = z.infer<typeof ReceiptsSettingsV1>;

export interface SettingsBySection {
  payments: PaymentsSettings;
  ranking: RankingSettings;
  notifications: NotificationsSettings;
  branding: BrandingSettings;
  receipts: ReceiptsSettings;
}

export const SETTINGS_SECTIONS = Object.keys(SETTINGS_SCHEMAS) as SettingsSection[];

export function defaultSettings<S extends SettingsSection>(section: S): SettingsBySection[S] {
  return SETTINGS_SCHEMAS[section].parse({}) as SettingsBySection[S];
}

/** Lleva datos guardados en cualquier versión a la actual y los valida. */
export function upgradeSettings<S extends SettingsSection>(
  section: S,
  version: number,
  data: unknown,
): SettingsBySection[S] {
  let current = data;
  for (let v = version; v < CURRENT_SETTINGS_VERSION[section]; v++) {
    const migrate = SETTINGS_MIGRATIONS[section]?.[v];
    if (!migrate) throw new Error(`Falta la migración de ajustes ${section} v${v}`);
    current = migrate(current);
  }
  return SETTINGS_SCHEMAS[section].parse(current) as SettingsBySection[S];
}
