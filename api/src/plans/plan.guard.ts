import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { type PlanFeature, PlanPolicyService } from './plan-policy.service';

export const REQUIRED_FEATURES = 'rs:requiredFeatures';

/** La ruta exige una función del plan (402 si no la tiene). Va después de OrgGuard. */
export const RequireFeature = (...features: PlanFeature[]) => SetMetadata(REQUIRED_FEATURES, features);

/** PlanGuard: valida las funciones del plan de la organización activa. */
@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly plans: PlanPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const features = this.reflector.getAllAndMerge<PlanFeature[]>(REQUIRED_FEATURES, [context.getHandler(), context.getClass()]) ?? [];
    if (features.length === 0) return true;
    const org = context.switchToHttp().getRequest<Request>().org;
    if (!org) return true;
    for (const f of features) await this.plans.assertFeature(org.id, f);
    return true;
  }
}
