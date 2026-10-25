import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/database.service';
import { PlanPolicyService } from '../plans/plan-policy.service';
import type { OrgContext } from '../tenancy/org-context';

/** Límites del plan al activar un sorteo (dentro de la transacción de publicar). */
@Injectable()
export class PlanPolicyHook {
  constructor(private readonly plans: PlanPolicyService) {}

  assertCanActivateRaffle(org: OrgContext, tx: Tx): Promise<void> {
    return this.plans.assertCanActivateRaffle(tx, org.id);
  }
}
