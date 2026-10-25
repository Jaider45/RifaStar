import type { OrgStatus } from '@prisma/client';
import type { OrgPermission } from '../permissions/catalog';

/** Organización activa de la request, resuelta por OrgGuard. */
export interface OrgContext {
  id: string;
  slug: string;
  name: string;
  status: OrgStatus;
  timezone: string;
  memberId: string | null;
  roleKey: string | null;
  permissions: ReadonlySet<OrgPermission>;
  /** Sesión de soporte de la plataforma: solo lectura. */
  readOnly: boolean;
  supportSessionId: string | null;
}

export const can = (org: OrgContext, permission: OrgPermission) => org.permissions.has(permission);
