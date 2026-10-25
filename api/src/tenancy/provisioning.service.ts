import { Injectable } from '@nestjs/common';
import { Prisma, type PrismaClient } from '@prisma/client';
import { Errors } from '../common/errors';
import { DatabaseService, type Tx } from '../database/database.service';
import { defaultSettings, SETTINGS_SECTIONS, CURRENT_SETTINGS_VERSION } from '../settings/schemas';

export interface ProvisionOrgInput {
  name: string;
  slug: string;
  ownerUserId: string;
  /** Sin plan: arranca en prueba con el plan de TrialConfig. */
  planCode?: string;
  timezone?: string;
  /** Hash del token de invitación: el owner queda «invitado» hasta aceptar (orgs creadas por la plataforma). */
  ownerInviteTokenHash?: string;
}

/**
 * Crea una organización completa: suscripción (prueba o plan), owner y ajustes
 * por defecto. Corre con el cliente de sistema porque la org aún no existe.
 */
@Injectable()
export class ProvisioningService {
  constructor(private readonly db: DatabaseService) {}

  async createOrganization(input: ProvisionOrgInput, tx?: Tx) {
    const run = (client: Tx | PrismaClient) => this.create(client as Tx, input);
    try {
      return tx ? await run(tx) : await this.db.system.$transaction((t) => run(t));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw Errors.slugTaken();
      throw err;
    }
  }

  private async create(tx: Tx, input: ProvisionOrgInput) {
    const ownerRole = await tx.role.findFirst({ where: { organizationId: null, key: 'owner' } });
    if (!ownerRole) throw new Error('Falta la plantilla de roles (ejecuta el seed base).');

    const now = new Date();
    let planId: string;
    let trialEndsAt: Date | null = null;
    if (input.planCode) {
      const plan = await tx.plan.findUnique({ where: { code: input.planCode } });
      if (!plan || plan.archivedAt) throw Errors.validation({ field: 'planCode' }, 'El plan no existe.');
      planId = plan.id;
    } else {
      const trial = await tx.trialConfig.findUnique({ where: { id: 1 } });
      if (!trial) throw new Error('Falta la configuración de la prueba (ejecuta el seed base).');
      planId = trial.planId;
      trialEndsAt = new Date(now.getTime() + trial.days * 86_400_000);
    }

    const existing = await tx.organization.findUnique({ where: { slug: input.slug } });
    if (existing) throw Errors.slugTaken();

    const org = await tx.organization.create({
      data: {
        name: input.name,
        slug: input.slug,
        timezone: input.timezone ?? 'America/Bogota',
        status: trialEndsAt ? 'trial' : 'active',
        trialEndsAt,
      },
    });
    await tx.subscription.create({
      data: {
        organizationId: org.id,
        planId,
        status: trialEndsAt ? 'trialing' : 'active',
        provider: 'manual',
        trialEndsAt,
        currentPeriodStart: now,
        currentPeriodEnd: trialEndsAt,
      },
    });
    await tx.member.create({
      data: {
        organizationId: org.id,
        userId: input.ownerUserId,
        roleId: ownerRole.id,
        ...(input.ownerInviteTokenHash
          ? { status: 'invited', inviteTokenHash: input.ownerInviteTokenHash, inviteExpiresAt: new Date(now.getTime() + 7 * 86_400_000) }
          : { status: 'active', joinedAt: now }),
      },
    });
    await tx.orgSettings.createMany({
      data: SETTINGS_SECTIONS.map((section) => ({
        organizationId: org.id,
        section,
        schemaVersion: CURRENT_SETTINGS_VERSION[section],
        data: defaultSettings(section) as Prisma.InputJsonValue,
      })),
    });
    return org;
  }
}
