import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pepperedHash, randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { MailProvider } from '../auth/mail/mail.provider';
import { invitationMail } from '../auth/mail/templates';
import { UsersService } from '../auth/users.service';
import { DatabaseService, type Tx } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';
import type { InviteMemberDto, UpdateMemberDto } from './organizations.dto';

const INVITE_TTL_MS = 7 * 86_400_000;

const memberView = {
  id: true,
  status: true,
  sellerCode: true,
  joinedAt: true,
  lastAccessAt: true,
  inviteExpiresAt: true,
  createdAt: true,
  user: { select: { id: true, name: true, email: true } },
  role: { select: { id: true, key: true, name: true, organizationId: true } },
} satisfies Prisma.MemberSelect;

@Injectable()
export class TeamService {
  constructor(
    private readonly db: DatabaseService,
    private readonly users: UsersService,
    private readonly audit: AuditService,
    private readonly mail: MailProvider,
  ) {}

  list(org: OrgContext) {
    return this.db.tenantTx(org.id, (tx) =>
      tx.member.findMany({
        where: { status: { not: 'removed' } },
        select: memberView,
        orderBy: [{ status: 'asc' }, { createdAt: 'asc' }],
      }),
    );
  }

  async invite(org: OrgContext, dto: InviteMemberDto) {
    const user = await this.users.findOrCreateInvitee(dto.email, dto.name);
    const token = randomToken(32);
    const member = await this.db.tenantTx(org.id, async (tx) => {
      const role = await this.assignableRole(tx, org, dto.roleId);
      const existing = await tx.member.findUnique({ where: { organizationId_userId: { organizationId: org.id, userId: user.id } } });
      if (existing && existing.status !== 'removed') {
        throw Errors.conflict('ALREADY_MEMBER', 'Esa persona ya está en tu equipo o tiene una invitación pendiente.');
      }
      const data = {
        roleId: role.id,
        status: 'invited' as const,
        sellerCode: dto.sellerCode ?? null,
        inviteTokenHash: pepperedHash(token),
        inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS),
        invitedById: org.memberId,
        removedAt: null,
        joinedAt: null,
      };
      const saved = await this.withSellerCodeCheck(() =>
        existing
          ? tx.member.update({ where: { id: existing.id }, data, select: memberView })
          : tx.member.create({ data: { ...data, organizationId: org.id, userId: user.id }, select: memberView }),
      );
      await this.audit.record(tx, {
        action: 'member.invite',
        entityType: 'member',
        entityId: saved.id,
        after: { email: dto.email, role: role.key, sellerCode: dto.sellerCode ?? null },
      });
      return { saved, roleName: role.name };
    });
    await this.mail.send(invitationMail(dto.email, org.name, member.roleName, this.inviteLink(token)));
    return member.saved;
  }

  async resendInvitation(org: OrgContext, memberId: string) {
    const token = randomToken(32);
    const result = await this.db.tenantTx(org.id, async (tx) => {
      const member = await tx.member.findFirst({ where: { id: memberId }, include: { user: true, role: true } });
      if (!member) throw Errors.notFound('el miembro');
      if (member.status !== 'invited') throw Errors.conflict('NOT_INVITED', 'Esta persona ya aceptó la invitación.');
      await tx.member.update({
        where: { id: member.id },
        data: { inviteTokenHash: pepperedHash(token), inviteExpiresAt: new Date(Date.now() + INVITE_TTL_MS) },
      });
      await this.audit.record(tx, { action: 'member.invite_resend', entityType: 'member', entityId: member.id });
      return member;
    });
    await this.mail.send(invitationMail(result.user.email, org.name, result.role.name, this.inviteLink(token)));
  }

  update(org: OrgContext, memberId: string, dto: UpdateMemberDto) {
    return this.db.tenantTx(org.id, async (tx) => {
      const member = await tx.member.findFirst({ where: { id: memberId, status: { not: 'removed' } }, include: { role: true } });
      if (!member) throw Errors.notFound('el miembro');
      let roleId = member.roleId;
      if (dto.roleId && dto.roleId !== member.roleId) {
        const role = await this.assignableRole(tx, org, dto.roleId);
        if (this.isOwnerRole(member.role)) {
          this.requireOwner(org);
          await this.ensureAnotherOwner(tx, member.id);
        }
        roleId = role.id;
      }
      const updated = await this.withSellerCodeCheck(() =>
        tx.member.update({
          where: { id: member.id },
          data: { roleId, ...(dto.sellerCode !== undefined && { sellerCode: dto.sellerCode }) },
          select: memberView,
        }),
      );
      await this.audit.record(tx, {
        action: 'member.update',
        entityType: 'member',
        entityId: member.id,
        before: { role: member.role.key, sellerCode: member.sellerCode },
        after: { role: updated.role.key, sellerCode: updated.sellerCode },
      });
      return updated;
    });
  }

  remove(org: OrgContext, memberId: string) {
    return this.db.tenantTx(org.id, async (tx) => {
      const member = await tx.member.findFirst({ where: { id: memberId, status: { not: 'removed' } }, include: { role: true } });
      if (!member) throw Errors.notFound('el miembro');
      if (this.isOwnerRole(member.role)) {
        this.requireOwner(org);
        await this.ensureAnotherOwner(tx, member.id);
      }
      await tx.member.update({
        where: { id: member.id },
        data: { status: 'removed', removedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null, sellerCode: null },
      });
      await this.audit.record(tx, { action: 'member.remove', entityType: 'member', entityId: member.id, before: { role: member.role.key } });
    });
  }

  private inviteLink(token: string) {
    return `${env().PUBLIC_BASE_URL}/invitacion/${token}`;
  }

  private isOwnerRole(role: { key: string; organizationId: string | null }) {
    return role.organizationId === null && role.key === 'owner';
  }

  /** Solo un propietario puede nombrar o quitar propietarios. */
  private requireOwner(org: OrgContext) {
    if (org.roleKey !== 'owner') {
      throw Errors.forbidden(undefined);
    }
  }

  private async assignableRole(tx: Tx, org: OrgContext, roleId: string) {
    const role = await tx.role.findFirst({ where: { id: roleId, deletedAt: null } });
    if (!role) throw Errors.validation({ field: 'roleId' }, 'El rol no existe.');
    if (this.isOwnerRole(role)) this.requireOwner(org);
    return role;
  }

  /** Bloquea la fila de cada owner activo para que dos cambios simultáneos no dejen la org sin owner. */
  private async ensureAnotherOwner(tx: Tx, exceptMemberId: string) {
    const owners = await tx.$queryRaw<{ id: string }[]>`
      SELECT m.id FROM members m JOIN roles r ON r.id = m.role_id
       WHERE m.organization_id = app_current_org() AND r.organization_id IS NULL AND r.key = 'owner'
         AND m.status = 'active'
       FOR UPDATE OF m`;
    if (!owners.some((o) => o.id !== exceptMemberId)) throw Errors.lastOwner();
  }

  private async withSellerCodeCheck<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('SELLER_CODE_TAKEN', 'Ese código de vendedor ya lo usa otra persona del equipo.');
      }
      throw err;
    }
  }
}
