import { createParamDecorator, type ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthPrincipal } from './auth.types';

export const IS_PUBLIC = 'rs:isPublic';
/** Ruta sin sesión (pública, webhooks, login). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().auth as AuthPrincipal;
});
