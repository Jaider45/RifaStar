import { Injectable } from '@nestjs/common';
import type { Tx } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';

/**
 * Punto de enganche para los límites del plan al activar un sorteo. La
 * implementación real (PlanGuard / PlanPolicy) llega en la fase 6.
 */
@Injectable()
export class PlanPolicyHook {
  async assertCanActivateRaffle(_org: OrgContext, _tx: Tx): Promise<void> {}
}
