import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { IS_PUBLIC } from './decorators';
import { TokensService } from './tokens.service';

/**
 * Guard global: toda ruta exige un access token válido salvo las marcadas con
 * @Public(). Solo identifica al principal; la org y los permisos se resuelven
 * en OrgGuard / PlatformGuard.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.authRequired();
    const claims = this.tokens.verifyAccess(header.slice(7));

    switch (claims.typ) {
      case 'user':
        req.auth = { kind: 'user', userId: claims.sub };
        requestContext.patch({ actor: { type: 'user', id: claims.sub } });
        return true;
      case 'platform':
        req.auth = { kind: 'platform', platformUserId: claims.sub, role: claims.role };
        requestContext.patch({ actor: { type: 'platform_user', id: claims.sub } });
        return true;
      case 'support':
        // La vigencia de la sesión se valida contra la base en OrgGuard.
        req.auth = {
          kind: 'support',
          platformUserId: claims.sub,
          organizationId: claims.org,
          supportSessionId: claims.sid,
          expiresAt: new Date(0),
        };
        requestContext.patch({
          actor: { type: 'platform_user', id: claims.sub, label: 'Soporte Rifa Star' },
          supportSessionId: claims.sid,
        });
        return true;
      default:
        throw Errors.authRequired();
    }
  }
}
