import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SettingsSection } from '@prisma/client';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Errors } from '../common/errors';
import type { OrgPermission } from '../permissions/catalog';
import { CurrentOrg, OrgScoped, RequirePermissionFor } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { SettingsService } from './settings.service';

class UpdateSettingsDto extends createZodDto(
  z.object({ revision: z.number().int().min(0), data: z.record(z.unknown()) }),
) {}

/** Permiso para escribir cada sección (§2.7 de la propuesta). */
const WRITE_PERMISSION: Record<SettingsSection, OrgPermission> = {
  payments: 'settings.brand',
  notifications: 'settings.brand',
  branding: 'settings.brand',
  receipts: 'settings.brand',
  ranking: 'ranking.configure',
};

const parseSection = (value: string): SettingsSection => {
  if (!(value in SettingsSection)) throw Errors.notFound('esa sección de ajustes');
  return value as SettingsSection;
};

@ApiTags('Ajustes')
@OrgScoped()
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  all(@CurrentOrg() org: OrgContext) {
    return this.settings.getAll(org);
  }

  @Get(':section')
  one(@CurrentOrg() org: OrgContext, @Param('section') section: string) {
    return this.settings.get(org, parseSection(section));
  }

  @Put(':section')
  @RequirePermissionFor((req) => WRITE_PERMISSION[req.params.section as SettingsSection] ?? null)
  update(@CurrentOrg() org: OrgContext, @Param('section') sectionParam: string, @Body() dto: UpdateSettingsDto) {
    const section = parseSection(sectionParam);
    return this.settings.update(org, section, dto.revision, dto.data);
  }
}
