import { Body, Controller, Get, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zUuid } from '../common/zod';
import { NotificationsService } from '../messaging/notifications.service';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import { RequireFeature } from '../plans/plan.guard';
import type { OrgContext } from '../tenancy/org-context';
import { RankingService } from './ranking.service';

class AdjustmentDto extends createZodDto(
  z.object({
    participantId: zUuid,
    points: z.number().int().min(-1000).max(1000).refine((n) => n !== 0, 'Los puntos no pueden ser 0.'),
    reason: z.string().trim().min(3, 'Escribe el motivo del ajuste.').max(300),
  }),
) {}

@ApiTags('Ranking')
@OrgScoped()
@RequireFeature('ranking')
@Controller('ranking')
export class RankingController {
  constructor(
    private readonly ranking: RankingService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('periods/:id/announce')
  @HttpCode(200)
  @RequirePermission('ranking.configure')
  announce(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.rankingTop10(org.id, id, 'manual');
  }

  @Get('current')
  @RequirePermission('raffles.view')
  current(@CurrentOrg() org: OrgContext) {
    return this.ranking.current(org);
  }

  @Get('periods')
  @RequirePermission('raffles.view')
  periods(@CurrentOrg() org: OrgContext) {
    return this.ranking.periods(org);
  }

  @Get('periods/:id')
  @RequirePermission('raffles.view')
  period(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.ranking.period(org, id);
  }

  @Get('periods/:id/export.csv')
  @RequirePermission('ranking.configure')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="ranking.csv"')
  export(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.ranking.exportCsv(org, id);
  }

  @Post('adjustments')
  @RequirePermission('ranking.configure')
  adjust(@CurrentOrg() org: OrgContext, @Body() dto: AdjustmentDto) {
    return this.ranking.adjust(org, dto.participantId, dto.points, dto.reason);
  }
}
