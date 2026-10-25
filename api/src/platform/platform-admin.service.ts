import { Injectable } from '@nestjs/common';
import { type PlatformRole, Prisma } from '@prisma/client';
import { randomToken } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { AuditService } from '../audit/audit.service';
import { MailProvider } from '../auth/mail/mail.provider';
import { PasswordService } from '../auth/password.service';
import { BillingService } from '../billing/billing.service';
import { DatabaseService } from '../database/database.service';
import { BASE_ROLE_TEMPLATE, LOCKED_ROLE_KEYS, PLATFORM_PERMISSION_KEYS } from '../permissions/catalog';
import type { AuditQuery, CreatePlanDto, CreatePlatformUserDto, TrialConfigDto, UpdatePlanDto, UpdatePlatformUserDto } from './platform.dto';

/** Planes, prueba, plantilla de roles, equipo de plataforma, facturación y auditoría. */
@Injectable()
export class PlatformAdminService {
  constructor(
    private readonly db: DatabaseService,
    private readonly audit: AuditService,
    private readonly passwords: PasswordService,
    private readonly mail: MailProvider,
    private readonly billing: BillingService,
  ) {}

  // --- Planes ----------------------------------------------------------------

  async plans() {
    const plans = await this.db.system.plan.findMany({ orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const counts = await this.db.system.subscription.groupBy({ by: ['planId'], where: { status: { not: 'canceled' } }, _count: true });
    return plans.map((p) => ({ ...p, subscribers: counts.find((c) => c.planId === p.id)?._count ?? 0 }));
  }

  async createPlan(dto: CreatePlanDto) {
    try {
      const plan = await this.db.system.plan.create({ data: dto });
      await this.audit.recordSystem({ action: 'platform.plan_create', entityType: 'plan', entityId: plan.id, after: dto });
      return plan;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('PLAN_CODE_TAKEN', 'Ya existe un plan con ese código.');
      }
      throw err;
    }
  }

  async updatePlan(id: string, dto: UpdatePlanDto) {
    const before = await this.db.system.plan.findUnique({ where: { id } });
    if (!before) throw Errors.notFound('el plan');
    const after = await this.db.system.plan.update({ where: { id }, data: dto });
    await this.audit.recordSystem({ action: 'platform.plan_update', entityType: 'plan', entityId: id, before, after });
    return after;
  }

  async archivePlan(id: string) {
    const active = await this.db.system.subscription.count({ where: { planId: id, status: { not: 'canceled' } } });
    if (active > 0) throw Errors.conflict('PLAN_IN_USE', `Hay ${active} organizaciones con este plan. Muévelas antes de archivarlo.`);
    const trial = await this.db.system.trialConfig.findUnique({ where: { id: 1 } });
    if (trial?.planId === id || trial?.downgradePlanId === id) {
      throw Errors.conflict('PLAN_IN_USE', 'Este plan está en la configuración de la prueba gratis.');
    }
    await this.db.system.plan.update({ where: { id }, data: { archivedAt: new Date() } });
    await this.audit.recordSystem({ action: 'platform.plan_archive', entityType: 'plan', entityId: id });
  }

  async trialConfig() {
    const t = await this.db.system.trialConfig.findUniqueOrThrow({ where: { id: 1 }, include: { plan: true, downgradePlan: true } });
    return {
      planCode: t.plan.code,
      days: t.days,
      onExpire: t.onExpire,
      downgradePlanCode: t.downgradePlan?.code ?? null,
      pastDueGraceDays: t.pastDueGraceDays,
    };
  }

  async updateTrialConfig(platformUserId: string, dto: TrialConfigDto) {
    const plan = await this.db.system.plan.findUnique({ where: { code: dto.planCode } });
    const downgrade = dto.downgradePlanCode ? await this.db.system.plan.findUnique({ where: { code: dto.downgradePlanCode } }) : null;
    if (!plan || (dto.downgradePlanCode && !downgrade)) throw Errors.validation({ field: 'planCode' }, 'El plan no existe.');
    if (dto.onExpire === 'downgrade_to_plan' && !downgrade) {
      throw Errors.validation({ field: 'downgradePlanCode' }, 'Indica a qué plan pasa la organización al terminar la prueba.');
    }
    const before = await this.trialConfig();
    await this.db.system.trialConfig.update({
      where: { id: 1 },
      data: { planId: plan.id, days: dto.days, onExpire: dto.onExpire, downgradePlanId: downgrade?.id ?? null, pastDueGraceDays: dto.pastDueGraceDays, updatedById: platformUserId },
    });
    await this.audit.recordSystem({ action: 'platform.trial_config_update', entityType: 'trial_config', entityId: '1', before, after: dto });
    return this.trialConfig();
  }

  // --- Plantilla de roles de organización (P10: aplica a todas las orgs) -----

  async roleTemplates() {
    const roles = await this.db.system.role.findMany({ where: { organizationId: null, deletedAt: null }, include: { permissions: true }, orderBy: { createdAt: 'asc' } });
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      locked: LOCKED_ROLE_KEYS.has(r.key),
      permissions: LOCKED_ROLE_KEYS.has(r.key) ? BASE_ROLE_TEMPLATE.owner.permissions : r.permissions.map((p) => p.permissionKey),
    }));
  }

  async setTemplatePermissions(roleKey: string, permissions: string[]) {
    if (LOCKED_ROLE_KEYS.has(roleKey)) {
      throw Errors.conflict('ROLE_LOCKED', 'El propietario siempre tiene todos los permisos.');
    }
    const role = await this.db.system.role.findFirst({ where: { organizationId: null, key: roleKey, deletedAt: null }, include: { permissions: true } });
    if (!role) throw Errors.notFound('el rol');
    const unique = [...new Set(permissions)];
    await this.db.system.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId: role.id } });
      await tx.rolePermission.createMany({ data: unique.map((permissionKey) => ({ roleId: role.id, permissionKey })) });
      await this.audit.recordSystem(
        { action: 'platform.role_template_update', entityType: 'role', entityId: role.id, before: { permissions: role.permissions.map((p) => p.permissionKey) }, after: { permissions: unique } },
        tx,
      );
    });
    return (await this.roleTemplates()).find((r) => r.key === roleKey);
  }

  // --- Equipo de la plataforma -----------------------------------------------

  async team() {
    const users = await this.db.system.platformUser.findMany({ orderBy: { createdAt: 'asc' } });
    const matrix = await this.platformRoleMatrix();
    return {
      members: users.map((u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        twoFactorEnabled: Boolean(u.totpEnabledAt),
        lastLoginAt: u.lastLoginAt,
        disabled: Boolean(u.disabledAt),
      })),
      roles: matrix,
    };
  }

  private async platformRoleMatrix() {
    const rows = await this.db.system.platformRolePermission.findMany();
    const roles: PlatformRole[] = ['super_admin', 'support', 'finance'];
    return roles.map((role) => ({
      role,
      locked: role === 'super_admin',
      permissions: role === 'super_admin' ? PLATFORM_PERMISSION_KEYS : rows.filter((r) => r.role === role).map((r) => r.permissionKey),
    }));
  }

  /** Alta con contraseña temporal por correo; el 2FA se configura en el primer ingreso. */
  async addPlatformUser(dto: CreatePlatformUserDto) {
    const temporary = randomToken(12);
    try {
      const user = await this.db.system.platformUser.create({
        data: { email: dto.email, name: dto.name, role: dto.role, passwordHash: await this.passwords.hash(temporary) },
      });
      await this.audit.recordSystem({ action: 'platform.team_add', entityType: 'platform_user', entityId: user.id, after: { email: dto.email, role: dto.role } });
      await this.mail.send({
        to: dto.email,
        subject: 'Tu acceso al equipo de Rifa Star',
        text: `Hola, ${dto.name}. Tu contraseña temporal es: ${temporary}\nAl entrar configurarás la verificación en dos pasos. Cámbiala después del primer ingreso.`,
      });
      return { id: user.id, email: user.email, name: user.name, role: user.role };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.emailTaken();
      throw err;
    }
  }

  async updatePlatformUser(actorId: string, id: string, dto: UpdatePlatformUserDto) {
    const user = await this.db.system.platformUser.findUnique({ where: { id } });
    if (!user) throw Errors.notFound('el usuario');
    const losingSuperAdmin = user.role === 'super_admin' && ((dto.role && dto.role !== 'super_admin') || dto.disabled);
    if (losingSuperAdmin) {
      const others = await this.db.system.platformUser.count({ where: { role: 'super_admin', disabledAt: null, id: { not: id } } });
      if (others === 0) throw new AppError('LAST_SUPER_ADMIN', 409, 'Debe quedar al menos un super admin activo.');
    }
    if (actorId === id && dto.disabled) throw Errors.conflict('SELF_DISABLE', 'No puedes desactivar tu propia cuenta.');
    const updated = await this.db.system.platformUser.update({
      where: { id },
      data: { role: dto.role, ...(dto.disabled !== undefined && { disabledAt: dto.disabled ? new Date() : null }) },
    });
    await this.audit.recordSystem({
      action: 'platform.team_update',
      entityType: 'platform_user',
      entityId: id,
      before: { role: user.role, disabled: Boolean(user.disabledAt) },
      after: { role: updated.role, disabled: Boolean(updated.disabledAt) },
    });
    if (dto.disabled) await this.db.system.refreshToken.updateMany({ where: { platformUserId: id, revokedAt: null }, data: { revokedAt: new Date() } });
    return { id: updated.id, role: updated.role, disabled: Boolean(updated.disabledAt) };
  }

  async setPlatformRolePermissions(role: PlatformRole, permissions: string[]) {
    if (role === 'super_admin') throw Errors.conflict('ROLE_LOCKED', 'El super admin siempre tiene todos los permisos.');
    const unique = [...new Set(permissions)];
    const before = (await this.platformRoleMatrix()).find((r) => r.role === role);
    await this.db.system.$transaction([
      this.db.system.platformRolePermission.deleteMany({ where: { role } }),
      this.db.system.platformRolePermission.createMany({ data: unique.map((permissionKey) => ({ role, permissionKey })) }),
    ]);
    await this.audit.recordSystem({ action: 'platform.role_permissions_update', entityType: 'platform_role', entityId: role, before, after: { permissions: unique } });
    return (await this.platformRoleMatrix()).find((r) => r.role === role);
  }

  async changeOwnPassword(id: string, current: string, next: string) {
    const user = await this.db.system.platformUser.findUniqueOrThrow({ where: { id } });
    if (!(await this.passwords.verify(user.passwordHash, current))) throw Errors.invalidCredentials();
    await this.db.system.platformUser.update({ where: { id }, data: { passwordHash: await this.passwords.hash(next) } });
    await this.audit.recordSystem({ action: 'platform.password_change', entityType: 'platform_user', entityId: id });
  }

  // --- Facturación -------------------------------------------------------------

  async subscriptions(status?: string) {
    const subs = await this.db.system.subscription.findMany({
      where: { status: status as never },
      include: { plan: { select: { code: true, name: true, monthlyPriceCop: true } }, organization: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });
    return subs.map((s) => ({
      id: s.id,
      organization: s.organization,
      plan: s.plan,
      status: s.status,
      provider: s.provider,
      currentPeriodEnd: s.currentPeriodEnd,
      pastDueSince: s.pastDueSince,
      cancelAtPeriodEnd: s.cancelAtPeriodEnd,
    }));
  }

  async failedPayments() {
    const invoices = await this.db.system.invoice.findMany({
      where: { status: 'failed' },
      include: { organization: { select: { id: true, name: true, slug: true, status: true } } },
      orderBy: { attemptedAt: 'desc' },
      take: 200,
    });
    return invoices.map((i) => ({ id: i.id, organization: i.organization, amountCop: i.amountCop, attemptedAt: i.attemptedAt, failureReason: i.failureReason }));
  }

  async billingEvents() {
    const events = await this.db.system.billingEvent.findMany({ orderBy: { receivedAt: 'desc' }, take: 200 });
    return events.map((e) => ({ id: e.id, provider: e.provider, type: e.type, externalEventId: e.externalEventId, receivedAt: e.receivedAt, processedAt: e.processedAt, attempts: e.attempts, lastError: e.lastError }));
  }

  async retryBillingEvent(id: string) {
    const event = await this.db.system.billingEvent.findUnique({ where: { id } });
    if (!event) throw Errors.notFound('el evento');
    await this.audit.recordSystem({ action: 'platform.billing_event_retry', entityType: 'billing_event', entityId: id });
    await this.billing.processEvent(id);
    return (await this.billingEvents()).find((e) => e.id === id);
  }

  // --- Registro de actividad ------------------------------------------------

  async auditLogs(q: AuditQuery) {
    const rows = await this.db.system.auditLog.findMany({
      where: {
        organizationId: q.organizationId,
        actorType: q.actorType,
        actorId: q.actorId,
        action: q.action ? { startsWith: q.action } : undefined,
        entityType: q.entityType,
        createdAt: { gte: q.from, lte: q.to },
        ...(q.cursor && { id: { lt: BigInt(q.cursor) } }),
      },
      orderBy: { id: 'desc' },
      take: q.limit + 1,
    });
    const page = rows.slice(0, q.limit);
    return {
      items: page.map((r) => ({ ...r, id: r.id.toString() })),
      nextCursor: rows.length > q.limit ? page[page.length - 1].id.toString() : null,
    };
  }
}
