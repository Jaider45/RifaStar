import { Injectable } from '@nestjs/common';
import type { Plan, Subscription } from '@prisma/client';
import { AppError } from '../common/errors';
import { DatabaseService, type Tx } from '../database/database.service';

export type PlanFeature = 'ranking' | 'whatsappAutomation' | 'sellers' | 'customRoles' | 'customDomain' | 'whiteLabel';
export type PlanLimit = 'activeRaffles' | 'members';

const FEATURE_COLUMN: Record<PlanFeature, keyof Plan> = {
  ranking: 'featureRanking',
  whatsappAutomation: 'featureWhatsappAuto',
  sellers: 'featureSellers',
  customRoles: 'featureCustomRoles',
  customDomain: 'featureCustomDomain',
  whiteLabel: 'featureWhiteLabel',
};

const FEATURE_ERRORS: Record<PlanFeature, { code: string; message: string }> = {
  ranking: { code: 'PLAN_FEATURE_RANKING', message: 'Tu plan no incluye el ranking. Mejora tu plan para activarlo.' },
  whatsappAutomation: {
    code: 'PLAN_FEATURE_WHATSAPP_AUTOMATION',
    message: 'Tu plan no incluye notificaciones por WhatsApp. Mejora tu plan para usarlas.',
  },
  sellers: { code: 'PLAN_FEATURE_SELLERS', message: 'Tu plan no incluye vendedores con código. Mejora tu plan para usarlos.' },
  customRoles: { code: 'PLAN_FEATURE_CUSTOM_ROLES', message: 'Tu plan no incluye roles personalizados. Mejora al plan Agencia.' },
  customDomain: { code: 'PLAN_FEATURE_CUSTOM_DOMAIN', message: 'Tu plan no incluye dominio propio. Mejora al plan Agencia.' },
  whiteLabel: { code: 'PLAN_FEATURE_WHITE_LABEL', message: 'Quitar «Creado con Rifa Star» está disponible en el plan Agencia.' },
};

/** Estados de sorteo que cuentan como «activos» para el plan. */
const LIVE = ['active', 'sold_out', 'closed'] as const;

/**
 * Política central de planes (regla 8): qué plan tiene una organización,
 * qué funciones incluye y cuánto consume de cada límite. La API responde
 * 402 con un código claro cuando algo no está en el plan.
 */
@Injectable()
export class PlanPolicyService {
  constructor(private readonly db: DatabaseService) {}

  async subscriptionOf(organizationId: string): Promise<(Subscription & { plan: Plan }) | null> {
    return this.db.system.subscription.findFirst({
      where: { organizationId, status: { not: 'canceled' } },
      include: { plan: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Plan vigente (si no hay suscripción, el de la prueba). */
  async planOf(organizationId: string): Promise<Plan> {
    const sub = await this.subscriptionOf(organizationId);
    if (sub) return sub.plan;
    const trial = await this.db.system.trialConfig.findUniqueOrThrow({ where: { id: 1 }, include: { plan: true } });
    return trial.plan;
  }

  async hasFeature(organizationId: string, feature: PlanFeature): Promise<boolean> {
    return Boolean((await this.planOf(organizationId))[FEATURE_COLUMN[feature]]);
  }

  async assertFeature(organizationId: string, feature: PlanFeature): Promise<void> {
    if (!(await this.hasFeature(organizationId, feature))) {
      const e = FEATURE_ERRORS[feature];
      throw new AppError(e.code, 402, e.message, { feature });
    }
  }

  async whatsappLimit(organizationId: string): Promise<number> {
    return (await this.planOf(organizationId)).monthlyWhatsappMessages;
  }

  /** Bloquea la fila de la org: dos operaciones simultáneas no pueden pasarse del límite. */
  private async lockOrg(tx: Tx, organizationId: string) {
    await tx.$queryRaw`SELECT id FROM organizations WHERE id = ${organizationId}::uuid FOR UPDATE`;
  }

  /** Al publicar: límite de sorteos activos y prueba vencida. Debe correr dentro del tenantTx. */
  async assertCanActivateRaffle(tx: Tx, organizationId: string): Promise<void> {
    await this.lockOrg(tx, organizationId);
    const sub = await this.subscriptionOf(organizationId);
    if (sub?.status === 'incomplete') {
      throw new AppError('PLAN_TRIAL_EXPIRED', 402, 'Tu prueba gratis terminó. Elige un plan para publicar sorteos nuevos.');
    }
    const plan = sub?.plan ?? (await this.planOf(organizationId));
    if (plan.maxActiveRaffles === null) return;
    const active = await tx.raffle.count({ where: { status: { in: [...LIVE] }, deletedAt: null } });
    if (active >= plan.maxActiveRaffles) {
      throw new AppError(
        'PLAN_LIMIT_ACTIVE_RAFFLES',
        402,
        `Tu plan ${plan.name} permite ${plan.maxActiveRaffles} sorteos activos. Termina uno o mejora tu plan.`,
        { limit: plan.maxActiveRaffles, current: active },
      );
    }
  }

  /** Al invitar: miembros activos + invitaciones pendientes. Debe correr dentro del tenantTx. */
  async assertCanAddMember(tx: Tx, organizationId: string): Promise<void> {
    await this.lockOrg(tx, organizationId);
    const plan = await this.planOf(organizationId);
    const members = await tx.member.count({ where: { status: { in: ['active', 'invited'] } } });
    if (members >= plan.maxMembers) {
      throw new AppError(
        'PLAN_LIMIT_MEMBERS',
        402,
        `Tu plan ${plan.name} permite ${plan.maxMembers} ${plan.maxMembers === 1 ? 'miembro' : 'miembros'} en el equipo.`,
        { limit: plan.maxMembers, current: members },
      );
    }
  }

  async usage(tx: Tx, organizationId: string) {
    const plan = await this.planOf(organizationId);
    return {
      activeRaffles: { used: await tx.raffle.count({ where: { status: { in: [...LIVE] }, deletedAt: null } }), limit: plan.maxActiveRaffles },
      members: { used: await tx.member.count({ where: { status: { in: ['active', 'invited'] } } }), limit: plan.maxMembers },
    };
  }
}
