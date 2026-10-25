import { applyDecorators, createParamDecorator, type ExecutionContext, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';
import type { Request } from 'express';
import type { OrgContext } from '../tenancy/org-context';
import type { OrgPermission, PlatformPermission } from './catalog';
import { ALLOW_WHEN_SUSPENDED, PERMISSION_RESOLVER, REQUIRED_PERMISSIONS, REQUIRED_PLATFORM_PERMISSIONS } from './metadata';
import { PlanGuard } from '../plans/plan.guard';
import { OrgGuard } from './org.guard';
import { PlatformGuard } from './platform.guard';


/** Exige todas las claves indicadas en la organización activa. */
export const RequirePermission = (...permissions: OrgPermission[]) => SetMetadata(REQUIRED_PERMISSIONS, permissions);

/**
 * Permiso que depende de la request (p. ej. de un parámetro de ruta). Se
 * verifica en el guard, antes de validar el cuerpo.
 */
export const RequirePermissionFor = (resolve: (req: Request) => OrgPermission | OrgPermission[] | null) =>
  SetMetadata(PERMISSION_RESOLVER, resolve);

export const RequirePlatformPermission = (...permissions: PlatformPermission[]) =>
  SetMetadata(REQUIRED_PLATFORM_PERMISSIONS, permissions);

/** Rutas que siguen disponibles con la cuenta suspendida (pagar el plan). */
export const AllowWhenSuspended = () => SetMetadata(ALLOW_WHEN_SUSPENDED, true);

/** Controlador del panel de una organización: sesión + X-Organization-Id + permisos. */
export const OrgScoped = () =>
  applyDecorators(
    UseGuards(OrgGuard, PlanGuard),
    ApiBearerAuth(),
    ApiHeader({ name: 'X-Organization-Id', required: true, description: 'Organización activa' }),
  );

/** Controlador de la plataforma: sesión de plataforma con 2FA + permisos platform.*. */
export const PlatformScoped = () => applyDecorators(UseGuards(PlatformGuard), ApiBearerAuth());

export const CurrentOrg = createParamDecorator((_data: unknown, ctx: ExecutionContext): OrgContext => {
  return ctx.switchToHttp().getRequest<Request>().org!;
});
