import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors';
import { slugify } from '../common/slug';
import { AuditService } from '../audit/audit.service';
import { DatabaseService, type Tx } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import type { OrgContext } from '../tenancy/org-context';
import type { CreateRoleDto, UpdateRoleDto } from './organizations.dto';

@Injectable()
export class RolesService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly permissions: PermissionsService,
  ) {}

  /** Roles base (plantilla de plataforma) + personalizados de la org. */
  list(org: OrgContext) {
    return this.db.tenantTx(org.id, async (tx) => {
      const roles = await tx.role.findMany({
        where: { deletedAt: null, OR: [{ organizationId: null }, { organizationId: org.id }] },
        include: { permissions: true, _count: { select: { members: { where: { organizationId: org.id, status: { not: 'removed' } } } } } },
        orderBy: [{ isSystem: 'desc' }, { createdAt: 'asc' }],
      });
      return roles.map((r) => this.present(r));
    });
  }

  private present(r: {
    id: string;
    key: string;
    name: string;
    description: string | null;
    organizationId: string | null;
    permissions: { permissionKey: string }[];
    _count?: { members: number };
  }) {
    return {
      id: r.id,
      key: r.key,
      name: r.name,
      description: r.description,
      custom: r.organizationId !== null,
      permissions: [...this.permissions.roleKeys(r.key, r.organizationId, r.permissions)],
      membersCount: r._count?.members ?? undefined,
    };
  }

  create(org: OrgContext, dto: CreateRoleDto) {
    return this.db.tenantTx(org.id, async (tx) => {
      const key = await this.uniqueKey(tx, org.id, dto.name);
      const role = await tx.role.create({
        data: {
          organizationId: org.id,
          key,
          name: dto.name,
          description: dto.description,
          permissions: { createMany: { data: dto.permissions.map((permissionKey) => ({ permissionKey })) } },
        },
        include: { permissions: true },
      });
      await this.audit.record(tx, { action: 'role.create', entityType: 'role', entityId: role.id, after: { name: role.name, permissions: dto.permissions } });
      return this.present(role);
    });
  }

  update(org: OrgContext, roleId: string, dto: UpdateRoleDto) {
    return this.db.tenantTx(org.id, async (tx) => {
      const role = await this.ownRole(tx, org.id, roleId);
      const before = { name: role.name, permissions: role.permissions.map((p) => p.permissionKey) };
      await tx.role.update({ where: { id: role.id }, data: { name: dto.name, description: dto.description } });
      if (dto.permissions) {
        await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.rolePermission.createMany({ data: dto.permissions.map((permissionKey) => ({ roleId: role.id, permissionKey })) });
      }
      const after = await tx.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: true } });
      await this.audit.record(tx, {
        action: 'role.update',
        entityType: 'role',
        entityId: role.id,
        before,
        after: { name: after.name, permissions: after.permissions.map((p) => p.permissionKey) },
      });
      return this.present(after);
    });
  }

  remove(org: OrgContext, roleId: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const role = await this.ownRole(tx, org.id, roleId);
      const inUse = await tx.member.count({ where: { roleId: role.id, status: { not: 'removed' } } });
      if (inUse > 0) throw Errors.conflict('ROLE_IN_USE', 'Hay miembros con este rol. Cámbiales el rol antes de eliminarlo.', { members: inUse });
      await tx.role.update({ where: { id: role.id }, data: { deletedAt: new Date(), key: `${role.key}~${Date.now()}` } });
      await this.audit.record(tx, { action: 'role.delete', entityType: 'role', entityId: role.id, before: { name: role.name } });
    });
  }

  private async ownRole(tx: Tx, organizationId: string, roleId: string) {
    const role = await tx.role.findFirst({ where: { id: roleId, deletedAt: null }, include: { permissions: true } });
    if (!role) throw Errors.notFound('el rol');
    if (role.organizationId !== organizationId) {
      throw Errors.conflict('ROLE_IS_TEMPLATE', 'Los roles base los define la plataforma y no se pueden editar aquí.');
    }
    return role;
  }

  private async uniqueKey(tx: Tx, organizationId: string, name: string): Promise<string> {
    const base = slugify(name, 40) || 'rol';
    for (let i = 0; i < 50; i++) {
      const key = i === 0 ? base : `${base}-${i + 1}`;
      const clash = await tx.role.findFirst({ where: { key, OR: [{ organizationId }, { organizationId: null }] } });
      if (!clash) return key;
    }
    throw Errors.conflict('ROLE_NAME_TAKEN', 'Ya existe un rol con ese nombre.');
  }
}
