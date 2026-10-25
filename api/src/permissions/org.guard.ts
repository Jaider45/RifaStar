import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';
import { ORG_PERMISSION_KEYS, type OrgPermission } from './catalog';
import { ALLOW_WHEN_SUSPENDED, PERMISSION_RESOLVER, REQUIRED_PERMISSIONS } from './metadata';
import { PermissionsService } from './permissions.service';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
export const SUPPORT_ACTIVE_HEADER = 'X-Support-Active';
export const SUPPORT_SESSION_HEADER = 'X-Support-Session';
const LAST_ACCESS_THROTTLE_MS = 5 * 60_000;

/**
 * Resuelve la organización activa (cabecera X-Organization-Id), la membresía
 * del usuario o la sesión de soporte, y verifica @RequirePermission.
 */
@Injectable()
export class OrgGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();
    const auth = req.auth;
    if (!auth) throw Errors.authRequired();
    if (auth.kind !== 'user' && auth.kind !== 'support') throw Errors.forbidden();

    const header = req.header('x-organization-id');
    const organizationId = auth.kind === 'support' ? auth.organizationId : header;
    if (!organizationId || !UUID_RE.test(organizationId)) throw Errors.orgRequired();
    if (auth.kind === 'support' && header && header !== auth.organizationId) throw Errors.forbidden();

    const org = await this.db.system.organization.findUnique({ where: { id: organizationId } });
    if (!org) throw Errors.notMember();

    let ctx: OrgContext;
    if (auth.kind === 'user') {
      const membership = await this.permissions.resolveMembership(org.id, auth.userId);
      if (!membership) throw Errors.notMember();
      ctx = {
        id: org.id,
        slug: org.slug,
        name: org.name,
        status: org.status,
        timezone: org.timezone,
        memberId: membership.memberId,
        roleKey: membership.roleKey,
        permissions: membership.permissions,
        readOnly: false,
        supportSessionId: null,
      };
      await this.touchMember(membership.memberId, membership.lastAccessAt);
      await this.announceSupport(org.id, res);
    } else {
      const session = await this.db.system.supportSession.findUnique({ where: { id: auth.supportSessionId } });
      const now = new Date();
      if (
        !session ||
        session.organizationId !== org.id ||
        session.platformUserId !== auth.platformUserId ||
        session.endedAt ||
        session.expiresAt <= now
      ) {
        throw Errors.sessionExpired();
      }
      if (!SAFE_METHODS.has(req.method)) throw Errors.supportReadOnly();
      ctx = {
        id: org.id,
        slug: org.slug,
        name: org.name,
        status: org.status,
        timezone: org.timezone,
        memberId: null,
        roleKey: null,
        permissions: new Set(ORG_PERMISSION_KEYS),
        readOnly: true,
        supportSessionId: session.id,
      };
      res.setHeader(SUPPORT_SESSION_HEADER, `id=${session.id}; expires=${session.expiresAt.toISOString()}`);
    }

    const allowSuspended = this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_SUSPENDED, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (org.status === 'suspended' && !SAFE_METHODS.has(req.method) && !allowSuspended) {
      throw Errors.orgSuspended();
    }

    const required = [
      ...(this.reflector.getAllAndMerge<OrgPermission[]>(REQUIRED_PERMISSIONS, [context.getHandler(), context.getClass()]) ??
        []),
    ];
    const resolver = this.reflector.get<((r: Request) => OrgPermission | OrgPermission[] | null) | undefined>(
      PERMISSION_RESOLVER,
      context.getHandler(),
    );
    const dynamic = resolver?.(req);
    if (dynamic) required.push(...(Array.isArray(dynamic) ? dynamic : [dynamic]));
    const missing = required.filter((p) => !ctx.permissions.has(p));
    if (missing.length > 0) throw Errors.forbidden({ missing });

    req.org = ctx;
    requestContext.patch({ organizationId: org.id });
    res.setHeader('X-Account-Status', org.status);

    if (ctx.readOnly) {
      await this.db.system.auditLog.create({
        data: {
          actorType: 'platform_user',
          actorId: auth.kind === 'support' ? auth.platformUserId : null,
          actorLabel: 'Soporte Rifa Star',
          organizationId: org.id,
          supportSessionId: ctx.supportSessionId,
          action: 'support.request',
          entityType: 'http',
          entityId: `${req.method} ${req.path}`.slice(0, 200),
          ip: requestContext.get()?.ip ?? null,
          requestId: requestContext.get()?.requestId ?? null,
        },
      });
    }
    return true;
  }

  /** El organizador ve un aviso mientras soporte esté dentro de su cuenta. */
  private async announceSupport(organizationId: string, res: Response): Promise<void> {
    const active = await this.db.system.supportSession.findFirst({
      where: { organizationId, endedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { expiresAt: 'desc' },
    });
    if (active) res.setHeader(SUPPORT_ACTIVE_HEADER, `expires=${active.expiresAt.toISOString()}`);
  }

  private async touchMember(memberId: string, lastAccessAt: Date | null): Promise<void> {
    if (lastAccessAt && Date.now() - lastAccessAt.getTime() < LAST_ACCESS_THROTTLE_MS) return;
    await this.db.system.member.update({ where: { id: memberId }, data: { lastAccessAt: new Date() } });
  }
}
