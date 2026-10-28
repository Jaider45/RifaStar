import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '../common/zod';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { ReceiptsService } from './receipts.service';

class PageQueryDto extends createZodDto(
  z.object({
    cursor: zUuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
) {}

class VoidReceiptDto extends createZodDto(z.object({ reason: z.string().trim().min(3, 'Escribe el motivo.').max(300) })) {}

@ApiTags('Comprobantes de ingreso')
@OrgScoped()
@Controller('receipts')
export class ReceiptsController {
  constructor(private readonly receipts: ReceiptsService) {}

  @Get('eligible')
  @RequirePermission('receipts.issue')
  eligible(@CurrentOrg() org: OrgContext, @Query() page: PageQueryDto) {
    return this.receipts.eligible(org, page);
  }

  @Get()
  @RequirePermission('receipts.issue')
  list(@CurrentOrg() org: OrgContext, @Query() page: PageQueryDto) {
    return this.receipts.list(org, page);
  }

  @Post('orders/:orderId')
  @RequirePermission('receipts.issue')
  issue(@CurrentOrg() org: OrgContext, @Param('orderId', ParseUUIDPipe) orderId: string) {
    return this.receipts.issue(org, orderId);
  }

  /** Anular a mano (p. ej. sorteo cancelado con devolución). Mismo permiso que liberar un pago. */
  @Post(':id/void')
  @HttpCode(200)
  @RequirePermission('payments.release')
  void(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VoidReceiptDto) {
    return this.receipts.void(org, id, dto.reason);
  }

  @Get(':id')
  @RequirePermission('receipts.issue')
  get(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.receipts.get(org, id);
  }
}
