import { Body, Controller, Delete, Get, HttpCode, Param, ParseEnumPipe, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { PlanPolicyHook } from './plan-hook';
import {
  CancelRaffleDto,
  CreateRaffleDto,
  DuplicateRaffleDto,
  ListRafflesQuery,
  MEDIA_KINDS,
  type MediaKind,
  ReplacePrizesDto,
  UpdateRaffleDto,
  UploadConfirmDto,
  UploadRequestDto,
} from './raffles.dto';
import { RafflesService } from './raffles.service';

@ApiTags('Sorteos')
@OrgScoped()
@Controller('raffles')
export class RafflesController {
  constructor(
    private readonly raffles: RafflesService,
    private readonly planHook: PlanPolicyHook,
  ) {}

  @Get()
  @RequirePermission('raffles.view')
  list(@CurrentOrg() org: OrgContext, @Query() query: ListRafflesQuery) {
    return this.raffles.list(org, query);
  }

  @Post()
  @RequirePermission('raffles.edit')
  create(@CurrentOrg() org: OrgContext, @Body() dto: CreateRaffleDto) {
    return this.raffles.create(org, dto);
  }

  @Get(':id')
  @RequirePermission('raffles.view')
  get(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.raffles.get(org, id);
  }

  @Patch(':id')
  @RequirePermission('raffles.edit')
  update(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRaffleDto) {
    return this.raffles.update(org, id, dto);
  }

  @Put(':id/prizes')
  @RequirePermission('raffles.edit')
  prizes(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReplacePrizesDto) {
    return this.raffles.replacePrizes(org, id, dto.prizes);
  }

  @Post(':id/cover')
  @RequirePermission('raffles.edit')
  cover(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadRequestDto) {
    return this.raffles.coverUpload(org, id, dto);
  }

  @Post(':id/cover/confirm')
  @RequirePermission('raffles.edit')
  coverConfirm(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UploadConfirmDto) {
    return this.raffles.coverConfirm(org, id, dto.key);
  }

  /** Galería (`gallery`) o foto de un premio (`prize`): URL firmada para subir. */
  @Post(':id/media/:kind')
  @RequirePermission('raffles.edit')
  media(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind', new ParseEnumPipe(MEDIA_KINDS)) kind: MediaKind, @Body() dto: UploadRequestDto) {
    return this.raffles.mediaUpload(org, id, kind, dto);
  }

  /** Verifica la foto subida y devuelve su key para guardarla en `galleryKeys` o en el premio. */
  @Post(':id/media/:kind/confirm')
  @HttpCode(200)
  @RequirePermission('raffles.edit')
  mediaConfirm(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Param('kind', new ParseEnumPipe(MEDIA_KINDS)) kind: MediaKind, @Body() dto: UploadConfirmDto) {
    return this.raffles.mediaConfirm(org, id, kind, dto.key);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @RequirePermission('raffles.publish')
  publish(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.raffles.publish(org, id, (tx) => this.planHook.assertCanActivateRaffle(org, tx));
  }

  @Post(':id/close-sales')
  @HttpCode(200)
  @RequirePermission('raffles.publish')
  async closeSales(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.raffles.closeSales(org.id, id, { manual: true });
    return this.raffles.get(org, id);
  }

  @Post(':id/duplicate')
  @RequirePermission('raffles.edit')
  duplicate(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: DuplicateRaffleDto) {
    return this.raffles.duplicate(org, id, dto);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermission('raffles.publish')
  cancel(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelRaffleDto) {
    return this.raffles.cancel(org, id, dto.reason);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('raffles.delete')
  async remove(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.raffles.remove(org, id);
  }

  @Get(':id/numbers')
  @RequirePermission('raffles.view')
  numbers(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.raffles.numbers(org, id);
  }
}
