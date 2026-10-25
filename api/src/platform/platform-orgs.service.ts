import { Injectable } from '@nestjs/common';
import { type OrgStatus, Prisma } from '@prisma/client';
import { pepperedHash, randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { MailProvider } from '../auth/mail/mail.provider';
import { invitationMail } from '../auth/mail/templates';
import { TokensService } from '../auth/tokens.service';
import { DatabaseService } from '../database/database.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import type { CreateOrgDto, ListOrgsQuery, ManualSubscriptionDto, UpdateOrgDto } from './platform.dto';

const LIVE = ['active', 'sold_out', 'closed'] as const;

@Injectable()
export class PlatformOrgsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly provisioning: ProvisioningService,
    private readonly tokens: TokensService,
    private readonly mail: MailProvider,
  ) {}

  async stats(includeRevenue: boolean) {
    const byStatus = await this.db.system.organization.groupBy({ by: ['status'], _count: true });
    const count = (s: OrgStatus) => byStatus.find((b) => b.status === s)?._count ?? 0;
    const since = new Date(Date.now() - 30 * 86_400_000);
    const failed = await this.db.system.invoice.count({ where: { status: 'failed', attemptedAt: { gte: since } } });
    let mrrCop: number | undefined;
    if (includeRevenue) {
      const subs = await this.db.system.subscription.findMany({
        where: { status: { in: ['active', 'past_due'] }, provider: { not: 'manual' } },
        include: { plan: { select: { monthlyPriceCop: true } } },
      });
      mrrCop = subs.reduce((n, s) => n + s.plan.monthlyPriceCop, 0);
    }
    return {
      organizations: {
        total: byStatus.reduce((n, b) => n + b._count, 0),
        active: count('active'),
        trial: count('trial'),
        pastDue: count('past_due'),
        suspended: count('suspended'),
      },
      failedPayments30d: failed,
      ...(mrrCop !== undefined && { mrrCop }),
    };
  }

  async list(query: ListOrgsQuery) {
    const where: Prisma.OrganizationWhereInput = {
      status: query.status,
      ...(query.q && {
        OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { slug: { contains: query.q.toLowerCase() } }],
      }),
    };
    const rows = await this.db.system.organization.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      take: query.limit + 1,
      ...(query.cursor && { cursor: { id: query.cursor }, skip: 1 }),
      include: {
        subscriptions: { where: { status: { not: 'canceled' } }, include: { plan: true }, take: 1 },
        members: { where: { status: { in: ['active', 'invited'] } }, include: { user: true, role: true } },
        _count: { select: { raffles: { where: { status: { in: [...LIVE] }, deletedAt: null } } } },
      },
    });
    const page = rows.slice(0, query.limit);
    return {
      items: page.map((o) => {
        const owner = o.members.find((m) => m.role.key === 'owner' && m.role.organizationId === null);
        const lastAccess = o.members.map((m) => m.lastAccessAt).filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
        const sub = o.subscriptions[0];
        return {
          id: o.id,
          name: o.name,
          slug: o.slug,
          status: o.status,
          owner: owner && { name: owner.user.name, email: owner.user.email },
          plan: sub && { code: sub.plan.code, name: sub.plan.name, subscriptionStatus: sub.status },
          trialEndsAt: o.trialEndsAt,
          activeRaffles: o._count.raffles,
          lastAccessAt: lastAccess,
          createdAt: o.createdAt,
        };
      }),
      nextCursor: rows.length > query.limit ? page[page.length - 1].id : null,
    };
  }

  async detail(id: string) {
    const o = await this.db.system.organization.findUnique({
      where: { id },
      include: {
        subscriptions: { include: { plan: true }, orderBy: { createdAt: 'desc' }, take: 5 },
        members: { where: { status: { not: 'removed' } }, include: { user: { select: { name: true, email: true } }, role: { select: { key: true, name: true } } } },
        _count: { select: { raffles: true, participants: true } },
      },
    });
    if (!o) throw Errors.notFound('la organización');
    const supportSessions = await this.db.system.supportSession.findMany({ where: { organizationId: id }, orderBy: { startedAt: 'desc' }, take: 10 });
    return {
      id: o.id,
      name: o.name,
      slug: o.slug,
      status: o.status,
      suspensionReason: o.suspensionReason,
      timezone: o.timezone,
      customDomain: o.customDomain,
      customDomainVerifiedAt: o.customDomainVerifiedAt,
      trialEndsAt: o.trialEndsAt,
      createdAt: o.createdAt,
      subscriptions: o.subscriptions.map((s) => ({ id: s.id, plan: s.plan.code, status: s.status, provider: s.provider, currentPeriodEnd: s.currentPeriodEnd })),
      members: o.members.map((m) => ({ name: m.user.name, email: m.user.email, role: m.role.key, status: m.status, lastAccessAt: m.lastAccessAt })),
      counts: { raffles: o._count.raffles, participants: o._count.participants },
      supportSessions: supportSessions.map((s) => ({ id: s.id, reason: s.reason, startedAt: s.startedAt, expiresAt: s.expiresAt, endedAt: s.endedAt })),
    };
  }

  /** Crea la org con su owner invitado (recibe el enlace por correo). */
  async create(dto: CreateOrgDto) {
    const token = randomToken(32);
    const org = await this.db.system.$transaction(async (tx) => {
      const user = (await tx.user.findUnique({ where: { email: dto.ownerEmail } })) ?? (await tx.user.create({ data: { email: dto.ownerEmail, name: dto.ownerName } }));
      const created = await this.provisioning.createOrganization(
        { name: dto.name, slug: dto.slug, ownerUserId: user.id, planCode: dto.planCode, timezone: dto.timezone, ownerInviteTokenHash: pepperedHash(token) },
        tx,
      );
      await this.audit.recordSystem(
        { action: 'platform.org_create', entityType: 'organization', entityId: created.id, organizationId: created.id, after: { slug: created.slug, plan: dto.planCode ?? 'prueba' } },
        tx,
      );
      return created;
    });
    await this.mail.send(invitationMail(dto.ownerEmail, org.name, 'Propietario', `${env().PUBLIC_BASE_URL}/invitacion/${token}`));
    return this.detail(org.id);
  }

  async update(id: string, dto: UpdateOrgDto) {
    const before = await this.db.system.organization.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('la organización');
    try {
      const { customDomainVerified, ...fields } = dto;
      const after = await this.db.system.organization.update({
        where: { id },
        data: {
          ...fields,
          ...(customDomainVerified !== undefined && { customDomainVerifiedAt: customDomainVerified ? new Date() : null }),
        },
      });
      await this.audit.recordSystem({
        action: 'platform.org_update',
        entityType: 'organization',
        entityId: id,
        organizationId: id,
        before: { name: before.name, slug: before.slug, timezone: before.timezone, customDomainVerifiedAt: before.customDomainVerifiedAt },
        after: { name: after.name, slug: after.slug, timezone: after.timezone, customDomainVerifiedAt: after.customDomainVerifiedAt },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.slugTaken();
      throw err;
    }
    return this.detail(id);
  }

  async suspend(id: string, reason: string) {
    const org = await this.db.system.organization.findUnique({ where: { id } });
    if (!org) throw Errors.notFound('la organización');
    await this.db.system.organization.update({ where: { id }, data: { status: 'suspended', suspendedAt: new Date(), suspensionReason: reason } });
    await this.audit.recordSystem({ action: 'platform.org_suspend', entityType: 'organization', entityId: id, organizationId: id, before: { status: org.status }, after: { status: 'suspended', reason } });
    return this.detail(id);
  }

  async reactivate(id: string) {
    const org = await this.db.system.organization.findUnique({ where: { id } });
    if (!org) throw Errors.notFound('la organización');
    const sub = await this.db.system.subscription.findFirst({ where: { organizationId: id, status: { not: 'canceled' } } });
    const status: OrgStatus = sub?.status === 'trialing' ? 'trial' : sub?.status === 'past_due' ? 'past_due' : 'active';
    await this.db.system.organization.update({ where: { id }, data: { status, suspendedAt: null, suspensionReason: null } });
    await this.audit.recordSystem({ action: 'platform.org_reactivate', entityType: 'organization', entityId: id, organizationId: id, before: { status: org.status }, after: { status } });
    return this.detail(id);
  }

  /** Cambio manual de plan (sin pasarela). */
  async setSubscription(id: string, dto: ManualSubscriptionDto) {
    const plan = await this.db.system.plan.findUnique({ where: { code: dto.planCode } });
    if (!plan || plan.archivedAt) throw Errors.validation({ field: 'planCode' }, 'Ese plan no existe.');
    await this.db.system.$transaction(async (tx) => {
      const org = await tx.organization.findUnique({ where: { id } });
      if (!org) throw Errors.notFound('la organización');
      const previous = await tx.subscription.findFirst({ where: { organizationId: id, status: { not: 'canceled' } }, include: { plan: true } });
      if (previous) await tx.subscription.update({ where: { id: previous.id }, data: { status: 'canceled', canceledAt: new Date() } });
      await tx.subscription.create({
        data: { organizationId: id, planId: plan.id, status: 'active', provider: 'manual', currentPeriodStart: new Date(), currentPeriodEnd: dto.periodEnd ?? null },
      });
      if (org.status === 'trial' || org.status === 'past_due') await tx.organization.update({ where: { id }, data: { status: 'active' } });
      await this.audit.recordSystem(
        { action: 'platform.subscription_set', entityType: 'organization', entityId: id, organizationId: id, before: { plan: previous?.plan.code ?? null }, after: { plan: plan.code } },
        tx,
      );
    });
    return this.detail(id);
  }

  /** «Entrar como soporte» (regla 9): solo lectura, con vencimiento y auditado. */
  async startSupport(platformUserId: string, organizationId: string, reason: string, minutes: number) {
    const org = await this.db.system.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw Errors.notFound('la organización');
    const expiresAt = new Date(Date.now() + minutes * 60_000);
    const session = await this.db.system.supportSession.create({ data: { platformUserId, organizationId, reason, expiresAt } });
    await this.audit.recordSystem({
      action: 'support.session_start',
      entityType: 'support_session',
      entityId: session.id,
      organizationId,
      after: { reason, expiresAt: expiresAt.toISOString() },
    });
    return {
      sessionId: session.id,
      organizationId,
      expiresAt,
      readOnly: true,
      accessToken: this.tokens.signAccess({ typ: 'support', sub: platformUserId, org: organizationId, sid: session.id, ro: true }, minutes * 60),
    };
  }

  async endSupport(sessionId: string) {
    const session = await this.db.system.supportSession.findUnique({ where: { id: sessionId } });
    if (!session) throw Errors.notFound('la sesión de soporte');
    if (!session.endedAt) {
      await this.db.system.supportSession.update({ where: { id: sessionId }, data: { endedAt: new Date() } });
      await this.audit.recordSystem({ action: 'support.session_end', entityType: 'support_session', entityId: sessionId, organizationId: session.organizationId });
    }
  }
}
