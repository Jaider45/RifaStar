import { Body, Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentAuth, Public } from '../auth/decorators';
import { DatabaseService } from '../database/database.service';
import { JOB } from '../jobs/jobs.constants';
import { SchedulerService } from '../jobs/scheduler.service';
import { AllowWhenSuspended, CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { BillingService } from './billing.service';

class CheckoutDto extends createZodDto(z.object({ planCode: z.string().trim().min(2).max(40) })) {}

@ApiTags('Plan y facturación')
@OrgScoped()
@AllowWhenSuspended()
@Controller('billing')
export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly db: DatabaseService,
  ) {}

  @Get()
  @RequirePermission('settings.billing')
  overview(@CurrentOrg() org: OrgContext) {
    return this.billing.overview(org);
  }

  @Get('invoices')
  @RequirePermission('settings.billing')
  async invoices(@CurrentOrg() org: OrgContext) {
    return (await this.billing.overview(org)).invoices;
  }

  @Post('checkout')
  @HttpCode(200)
  @RequirePermission('settings.billing')
  async checkout(@CurrentOrg() org: OrgContext, @CurrentAuth() auth: AuthPrincipal, @Body() dto: CheckoutDto) {
    const email = auth.kind === 'user' ? (await this.db.tenantTx(org.id, (tx) => tx.user.findFirstOrThrow({ where: { id: auth.userId } }))).email : '';
    return this.billing.checkout(org, dto.planCode, email);
  }

  @Post('portal')
  @HttpCode(200)
  @RequirePermission('settings.billing')
  portal(@CurrentOrg() org: OrgContext) {
    return this.billing.portal(org);
  }
}

@ApiTags('Webhooks')
@Public()
@Controller('webhooks/billing')
export class BillingWebhookController {
  constructor(
    private readonly billing: BillingService,
    private readonly scheduler: SchedulerService,
  ) {}

  /** Verifica la firma, guarda el evento y lo procesa en billing-sync. */
  @Post('stripe')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async stripe(@Req() req: Request & { rawBody?: Buffer }, @Headers('stripe-signature') signature?: string) {
    const id = await this.billing.receiveWebhook(req.rawBody ?? Buffer.alloc(0), signature);
    if (id) await this.scheduler.maintenance.add(JOB.billingSync, { billingEventId: id }, { jobId: `billing-${id}` });
    return { received: true, duplicate: id === null };
  }
}
