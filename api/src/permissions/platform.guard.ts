import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Errors } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import type { PlatformPermission } from './catalog';
import { REQUIRED_PLATFORM_PERMISSIONS } from './metadata';
import { PermissionsService } from './permissions.service';

/** Solo usuarios de plataforma con sesión emitida tras el 2FA. */
@Injectable()
export class PlatformGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly db: DatabaseService,
    private readonly permissions: PermissionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.auth;
    if (!auth || auth.kind !== 'platform') throw Errors.forbidden();

    const user = await this.db.system.platformUser.findUnique({ where: { id: auth.platformUserId } });
    if (!user || user.disabledAt || !user.totpEnabledAt) throw Errors.sessionExpired();
    // El rol puede haber cambiado desde que se emitió el token.
    req.auth = { kind: 'platform', platformUserId: user.id, role: user.role };

    const required =
      this.reflector.getAllAndMerge<PlatformPermission[]>(REQUIRED_PLATFORM_PERMISSIONS, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length > 0) {
      const granted = await this.permissions.platformPermissions(user.role);
      const missing = required.filter((p) => !granted.has(p));
      if (missing.length > 0) throw Errors.forbidden({ missing });
    }
    return true;
  }
}
