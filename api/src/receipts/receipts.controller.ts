import { Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { ReceiptsService } from './receipts.service';

@ApiTags('Comprobantes de ingreso')
@OrgScoped()
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('eligible')
  @RequirePermission('receipts.issue')
  eligible(@CurrentOrg() org: OrgContext) {
    return this.receipts.eligible(org);
  }

  @Get()
  @RequirePermission('receipts.issue')
  list(@CurrentOrg() org: OrgContext) {
    return this.receipts.list(org);
  }

  @Post('orders/:orderId')
  @RequirePermission('receipts.issue')
  issue(@CurrentOrg() org: OrgContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.receipts.issue(org, orderId);
  }

  @Get(':id')
  @RequirePermission('receipts.issue')
  get(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.get(org, id);
  }
}
