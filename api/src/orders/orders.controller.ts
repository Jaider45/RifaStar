import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import { RequireFeature } from '../plans/plan.guard';
import type { OrgContext } from '../tenancy/org-context';
import { ListOrdersQuery, QueueQuery, ReasonDto, SalesQuery } from './orders.dto';
import { OrdersService } from './orders.service';

@ApiTags('Pagos')
@OrgScoped()
@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get('payments/queue')
  @RequirePermission('payments.view')
  queue(@CurrentOrg() org: OrgContext, @Query() query: QueueQuery) {
    return this.orders.queue(org, query.raffleId);
  }

  @Get('orders')
  @RequirePermission('payments.view')
  list(@CurrentOrg() org: OrgContext, @Query() query: ListOrdersQuery) {
    return this.orders.list(org, query);
  }

  @Get('orders/:id')
  @RequirePermission('payments.view')
  detail(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(org, id);
  }

  @Post('orders/:id/approve')
  @HttpCode(200)
  @RequirePermission('payments.approve')
  approve(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.orders.approve(org, id);
  }

  @Post('orders/:id/reject')
  @HttpCode(200)
  @RequirePermission('payments.approve')
  reject(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orders.reject(org, id, dto.reason);
  }

  @Post('orders/:id/release')
  @HttpCode(200)
  @RequirePermission('payments.release')
  release(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orders.release(org, id, dto.reason);
  }

  @Get('sales/mine')
  @RequirePermission('sales.view_own')
  @RequireFeature('sellers')
  salesMine(@CurrentOrg() org: OrgContext, @Query() query: SalesQuery) {
    return this.orders.salesMine(org, query);
  }
}
