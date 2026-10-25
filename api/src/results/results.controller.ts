import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationsService } from '../messaging/notifications.service';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import { UploadConfirmDto, UploadRequestDto } from '../raffles/raffles.dto';
import type { OrgContext } from '../tenancy/org-context';
import { DeliverDto, EnterResultDto } from './results.dto';
import { ResultsService } from './results.service';

@ApiTags('Resultados')
@OrgScoped()
@Controller()
export class ResultsController {
  constructor(
    private readonly results: ResultsService,
    private readonly notifications: NotificationsService,
  ) {}

  @Post('raffles/:id/results/notify')
  @HttpCode(200)
  @RequirePermission('winners.announce')
  notify(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.notifyWinners(org.id, id);
  }

  @Put('raffles/:id/result')
  @RequirePermission('winners.announce')
  enter(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: EnterResultDto) {
    return this.results.enter(org, id, dto);
  }

  @Post('raffles/:id/result/evidence')
  @RequirePermission('winners.announce')
  evidence(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadRequestDto) {
    return this.results.evidenceUpload(org, id, dto.contentType, dto.size);
  }

  @Post('raffles/:id/result/evidence/confirm')
  @RequirePermission('winners.announce')
  evidenceConfirm(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadConfirmDto) {
    return this.results.evidenceConfirm(org, id, dto.key);
  }

  @Post('raffles/:id/winners/recalculate')
  @HttpCode(200)
  @RequirePermission('winners.announce')
  recalculate(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.results.recalculate(org, id);
  }

  @Get('raffles/:id/winners')
  @RequirePermission('raffles.view')
  winners(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.results.winners(org, id);
  }

  @Post('winners/:id/deliver')
  @HttpCode(200)
  @RequirePermission('winners.announce')
  deliver(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DeliverDto) {
    return this.results.deliver(org, id, dto.note);
  }

  @Post('raffles/:id/results/publish')
  @HttpCode(200)
  @RequirePermission('winners.announce')
  publish(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.results.publish(org, id);
  }
}
