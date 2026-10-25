import { Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { DatabaseService } from '../database/database.service';

export type PlanFeature = 'ranking' | 'whatsappAutomation' | 'sellers' | 'customRoles' | 'customDomain' | 'whiteLabel';

const FEATURE_COLUMN: Record<PlanFeature, keyof Plan> = {
  ranking: 'featureRanking',
  whatsappAutomation: 'featureWhatsappAuto',
  sellers: 'featureSellers',
  customRoles: 'featureCustomRoles',
  customDomain: 'featureCustomDomain',
  whiteLabel: 'featureWhiteLabel',
};

/**
 * Política central de planes: qué plan tiene una organización y qué permite.
 * PlanGuard (decoradores) y los servicios la consultan; nadie más lee planes.
 */
@Injectable()
export class PlanPolicyService {
  constructor(private readonly db: DatabaseService) {}

  /** Plan vigente (la suscripción no cancelada). */
  async planOf(organizationId: string): Promise<Plan> {
    const sub = await this.db.system.subscription.findFirst({
      where: { organizationId, status: { not: 'canceled' } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
    if (sub) return sub.plan;
    const trial = await this.db.system.trialConfig.findUniqueOrThrow({ where: { id: 1 }, include: { plan: true } });
    return trial.plan;
  }

  async hasFeature(organizationId: string, feature: PlanFeature): Promise<boolean> {
    return Boolean((await this.planOf(organizationId))[FEATURE_COLUMN[feature]]);
  }

  async whatsappLimit(organizationId: string): Promise<number> {
    return (await this.planOf(organizationId)).monthlyWhatsappMessages;
  }
}
