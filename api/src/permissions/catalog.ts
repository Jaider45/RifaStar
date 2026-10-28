import type { PlatformRole } from '@prisma/client';

/** Claves de permiso de una organización (§5). */
export const ORG_PERMISSIONS = [
  { key: 'raffles.view', group: 'Sorteos', description: 'Ver sorteos' },
  { key: 'raffles.edit', group: 'Sorteos', description: 'Crear y editar sorteos' },
  { key: 'raffles.publish', group: 'Sorteos', description: 'Publicar y cerrar ventas' },
  { key: 'raffles.delete', group: 'Sorteos', description: 'Eliminar sorteos' },
  { key: 'payments.view', group: 'Pagos', description: 'Ver pagos y comprobantes' },
  { key: 'payments.approve', group: 'Pagos', description: 'Aprobar o rechazar pagos' },
  { key: 'payments.release', group: 'Pagos', description: 'Liberar números y reembolsar' },
  { key: 'receipts.issue', group: 'Pagos', description: 'Emitir y consultar comprobantes de ingreso' },
  { key: 'participants.view_contact', group: 'Participantes', description: 'Ver nombre y WhatsApp' },
  { key: 'participants.export', group: 'Participantes', description: 'Exportar la base de datos' },
  { key: 'sales.view_own', group: 'Participantes', description: 'Ver ventas propias (código de vendedor)' },
  { key: 'ranking.configure', group: 'Ranking y ganadores', description: 'Configurar el ranking' },
  { key: 'winners.announce', group: 'Ranking y ganadores', description: 'Anunciar ganadores' },
  { key: 'settings.brand', group: 'Ajustes', description: 'Marca, pagos y notificaciones' },
  { key: 'settings.team', group: 'Ajustes', description: 'Invitar y quitar miembros' },
  { key: 'settings.billing', group: 'Ajustes', description: 'Plan y facturación' },
] as const;

export type OrgPermission = (typeof ORG_PERMISSIONS)[number]['key'];
export const ORG_PERMISSION_KEYS = ORG_PERMISSIONS.map((p) => p.key) as OrgPermission[];

/**
 * Permisos que mueven dinero, resultados o datos de muchas personas. Quien los ejerce
 * debe tener activa la verificación en dos pasos (plan de seguridad, punto 1).
 */
export const TWO_FACTOR_PERMISSIONS: ReadonlySet<OrgPermission> = new Set<OrgPermission>([
  'payments.approve',
  'payments.release',
  'winners.announce',
  'participants.export',
  'settings.team',
  'settings.billing',
]);

export const needsTwoFactor = (permissions: Iterable<OrgPermission>): boolean =>
  [...permissions].some((p) => TWO_FACTOR_PERMISSIONS.has(p));

/** Claves de permiso del equipo de la plataforma. */
export const PLATFORM_PERMISSIONS = [
  { key: 'platform.orgs.read', group: 'Organizaciones', description: 'Ver organizaciones y actividad' },
  { key: 'platform.orgs.write', group: 'Organizaciones', description: 'Crear, suspender y reactivar organizaciones' },
  { key: 'platform.plans.write', group: 'Planes', description: 'Editar planes, límites y la prueba gratis' },
  { key: 'platform.billing.read', group: 'Facturación', description: 'Ver suscripciones y cobros' },
  { key: 'platform.billing.write', group: 'Facturación', description: 'Cambiar suscripciones y reprocesar cobros' },
  { key: 'platform.roles.write', group: 'Roles', description: 'Editar roles y el equipo de la plataforma' },
  { key: 'platform.impersonate', group: 'Soporte', description: 'Entrar como soporte (solo lectura)' },
] as const;

export type PlatformPermission = (typeof PLATFORM_PERMISSIONS)[number]['key'];
export const PLATFORM_PERMISSION_KEYS = PLATFORM_PERMISSIONS.map((p) => p.key) as PlatformPermission[];

export type BaseRoleKey = 'owner' | 'admin' | 'payment_verifier' | 'seller';

const except = (...keys: OrgPermission[]) => ORG_PERMISSION_KEYS.filter((k) => !keys.includes(k));

/** Plantilla de roles base que reciben todas las organizaciones. */
export const BASE_ROLE_TEMPLATE: Record<BaseRoleKey, { name: string; description: string; permissions: OrgPermission[] }> = {
  owner: {
    name: 'Propietario',
    description: 'Todo, incluido el plan, la facturación y el equipo.',
    permissions: [...ORG_PERMISSION_KEYS],
  },
  admin: {
    name: 'Administrador',
    description: 'Todo, menos facturación, equipo, exportar y eliminar sorteos.',
    permissions: except('raffles.delete', 'participants.export', 'settings.team', 'settings.billing'),
  },
  payment_verifier: {
    name: 'Verificador de pagos',
    description: 'Solo ve y aprueba pagos de los sorteos.',
    permissions: ['raffles.view', 'payments.view', 'payments.approve', 'receipts.issue', 'participants.view_contact'],
  },
  seller: {
    name: 'Vendedor',
    description: 'Comparte enlaces con su código y ve sus ventas.',
    permissions: ['raffles.view', 'sales.view_own'],
  },
};

/** El owner siempre tiene todas las claves: su fila de la plantilla no se edita. */
export const LOCKED_ROLE_KEYS: ReadonlySet<string> = new Set(['owner']);

export const DEFAULT_PLATFORM_ROLE_PERMISSIONS: Record<PlatformRole, PlatformPermission[]> = {
  super_admin: [...PLATFORM_PERMISSION_KEYS],
  support: ['platform.orgs.read', 'platform.impersonate'],
  finance: ['platform.orgs.read', 'platform.billing.read', 'platform.billing.write'],
};
