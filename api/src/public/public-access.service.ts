import { Injectable } from '@nestjs/common';
import type { Organization } from '@prisma/client';
import { AppError, Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { DatabaseService } from '../database/database.service';
import { PlanPolicyService } from '../plans/plan-policy.service';
import { verifyOrderToken } from '../orders/reservation.service';

/**
 * Resolución de la organización en las rutas públicas (por slug o por el id
 * de una orden). Es el único punto público que usa el cliente de sistema; de
 * aquí en adelante todo corre en `tenantTx`.
 */
@Injectable()
export class PublicAccessService {
  constructor(
    private readonly db: DatabaseService,
    private readonly plans: PlanPolicyService,
  ) {}

  async org(slug: string): Promise<Organization> {
    const org = await this.db.system.organization.findUnique({ where: { slug: slug.toLowerCase() } });
    if (!org) throw Errors.notFound('la organización');
    if (org.status === 'suspended') {
      throw new AppError('ORG_SUSPENDED', 403, 'Este sorteo no está disponible en este momento.');
    }
    requestContext.patch({ organizationId: org.id, actor: { type: 'participant', id: null } });
    return org;
  }

  async byDomain(host: string): Promise<{ slug: string; name: string }> {
    const org = await this.db.system.organization.findFirst({
      where: { customDomain: host.toLowerCase().replace(/:\d+$/, ''), customDomainVerifiedAt: { not: null } },
    });
    if (!org || org.status === 'suspended' || !(await this.plans.hasFeature(org.id, 'customDomain'))) {
      throw Errors.notFound('la organización');
    }
    return { slug: org.slug, name: org.name };
  }

  /** Valida el token de la orden. Responde 404 tanto si no existe como si el token no coincide. */
  async order(orderId: string, token: string | undefined): Promise<string> {
    const found = await this.db.system.order.findUnique({
      where: { id: orderId },
      select: { organizationId: true, accessTokenHash: true, participantId: true },
    });
    if (!found || !verifyOrderToken(orderId, token, found.accessTokenHash)) throw Errors.notFound('la orden');
    requestContext.patch({ organizationId: found.organizationId, actor: { type: 'participant', id: found.participantId } });
    return found.organizationId;
  }
}
