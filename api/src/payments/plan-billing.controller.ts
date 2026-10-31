import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators';
import { DatabaseService } from '../database/database.service';
import { AllowWhenSuspended, CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import { RateLimit } from '../rate-limit/rate-limit';
import type { OrgContext } from '../tenancy/org-context';
import { ChangeCardDto, SubscribePlanDto } from './payments.dto';
import { PlanBillingService } from './plan-billing.service';

class CardCheckoutQuery extends createZodDto(z.object({ planCode: z.string().trim().min(2).max(40) })) {}

/**
 * Plan con checkout propio (Wompi): la tarjeta se tokeniza en el navegador y aquí solo llega el
 * token. Se permite con la cuenta suspendida: así se reactiva pagando.
 */
@ApiTags('Plan y facturación')
@OrgScoped()
@AllowWhenSuspended()
@Controller('billing')
export class PlanBillingController {
  constructor(
    private readonly plans: PlanBillingService,
    private readonly db: DatabaseService,
  ) {}

  private async emailOf(org: OrgContext, auth: AuthPrincipal): Promise<string> {
    return auth.kind === 'user' ? (await this.db.tenantTx(org.id, (tx) => tx.user.findFirstOrThrow({ where: { id: auth.userId } }))).email : '';
  }

  @Get('card-checkout')
  @RequirePermission('settings.billing')
  config(@Query() query: CardCheckoutQuery) {
    return this.plans.checkoutConfig(query.planCode);
  }

  @Post('subscribe')
  @HttpCode(200)
  @RequirePermission('settings.billing')
  @RateLimit({ name: 'billing-subscribe', by: ['ip'], limit: 10, windowSeconds: 600 })
  async subscribe(@CurrentOrg() org: OrgContext, @CurrentAuth() auth: AuthPrincipal, @Body() dto: SubscribePlanDto) {
    return this.plans.subscribe(org, await this.emailOf(org, auth), dto);
  }

  @Get('subscribe/status')
  @RequirePermission('settings.billing')
  status(@CurrentOrg() org: OrgContext) {
    return this.plans.status(org);
  }

  @Post('card')
  @HttpCode(200)
  @RequirePermission('settings.billing')
  @RateLimit({ name: 'billing-card', by: ['ip'], limit: 10, windowSeconds: 600 })
  async card(@CurrentOrg() org: OrgContext, @CurrentAuth() auth: AuthPrincipal, @Body() dto: ChangeCardDto) {
    return this.plans.changeCard(org, await this.emailOf(org, auth), dto);
  }

  @Post('cancel')
  @HttpCode(200)
  @RequirePermission('settings.billing')
  cancel(@CurrentOrg() org: OrgContext) {
    return this.plans.setCancelAtPeriodEnd(org, true);
  }

  @Post('resume')
  @HttpCode(200)
  @RequirePermission('settings.billing')
  resume(@CurrentOrg() org: OrgContext) {
    return this.plans.setCancelAtPeriodEnd(org, false);
  }
}
