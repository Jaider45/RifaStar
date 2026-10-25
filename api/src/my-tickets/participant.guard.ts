import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TokensService } from '../auth/tokens.service';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';

/** Sesión de participante («Mis boletos»), atada a una organización. */
@Injectable()
export class ParticipantGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw Errors.authRequired();
    const claims = this.tokens.verifyParticipant(header.slice(7));
    req.auth = { kind: 'participant', participantId: claims.sub, organizationId: claims.org };
    requestContext.patch({ actor: { type: 'participant', id: claims.sub }, organizationId: claims.org });
    return true;
  }
}
