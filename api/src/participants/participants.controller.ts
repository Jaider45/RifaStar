import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zCursorQuery, zUuid } from '../common/zod';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { ParticipantsService } from './participants.service';

class ListParticipantsQuery extends createZodDto(
  zCursorQuery.extend({ q: z.string().trim().max(80).optional(), raffleId: zUuid.optional() }),
) {}
class ExportQuery extends createZodDto(z.object({ raffleId: zUuid.optional() })) {}

@ApiTags('Participantes')
@OrgScoped()
@Controller('participants')
export class ParticipantsController {
  constructor(private readonly participants: ParticipantsService) {}

  @Get()
  @RequirePermission('participants.view_contact')
  list(@CurrentOrg() org: OrgContext, @Query() query: ListParticipantsQuery) {
    return this.participants.list(org, query);
  }

  @Get('export.csv')
  @RequirePermission('participants.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="participantes.csv"')
  export(@CurrentOrg() org: OrgContext, @Query() query: ExportQuery) {
    return this.participants.exportCsv(org, query.raffleId);
  }

  @Get(':id')
  @RequirePermission('participants.view_contact')
  detail(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    return this.participants.detail(org, id);
  }
}
