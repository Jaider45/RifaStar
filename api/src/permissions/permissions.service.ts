import { Injectable } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';
import { DatabaseService } from '../database/database.service';
import {
  LOCKED_ROLE_KEYS,
  ORG_PERMISSION_KEYS,
  type OrgPermission,
  PLATFORM_PERMISSION_KEYS,
  type PlatformPermission,
} from './catalog';

const ORG_KEYS: ReadonlySet<string> = new Set(ORG_PERMISSION_KEYS);

@Injectable()
export class PermissionsService {
  constructor(private readonly db: DatabaseService) {}

  /** Membresía activa y sus claves de permiso. */
  async resolveMembership(organizationId: string, userId: string) {
    const member = await this.db.system.member.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      include: { role: { include: { permissions: true } } },
    });
    if (!member || member.status !== 'active' || member.role.deletedAt) return null;
    return {
      memberId: member.id,
      roleKey: member.role.key,
      isTemplateRole: member.role.organizationId === null,
      lastAccessAt: member.lastAccessAt,
      permissions: this.roleKeys(member.role.key, member.role.organizationId, member.role.permissions),
    };
  }

  roleKeys(
    roleKey: string,
    roleOrgId: string | null,
    rows: { permissionKey: string }[],
  ): ReadonlySet<OrgPermission> {
    if (roleOrgId === null && LOCKED_ROLE_KEYS.has(roleKey)) return new Set(ORG_PERMISSION_KEYS);
    return new Set(rows.map((r) => r.permissionKey).filter((k): k is OrgPermission => ORG_KEYS.has(k)));
  }

  async platformPermissions(role: PlatformRole): Promise<ReadonlySet<PlatformPermission>> {
    if (role === 'super_admin') return new Set(PLATFORM_PERMISSION_KEYS);
    const rows = await this.db.system.platformRolePermission.findMany({ where: { role } });
    return new Set(rows.map((r) => r.permissionKey as PlatformPermission));
  }
}
