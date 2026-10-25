import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ORG_PERMISSIONS } from '../permissions/catalog';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import type { OrgContext } from '../tenancy/org-context';
import { UploadConfirmDto, UploadRequestDto } from '../raffles/raffles.dto';
import { CreateRoleDto, InviteMemberDto, UpdateMemberDto, UpdateOrganizationDto, UpdateRoleDto } from './organizations.dto';
import { OrganizationService } from './organization.service';
import { RolesService } from './roles.service';
import { TeamService } from './team.service';

@ApiTags('Organización')
@OrgScoped()
@Controller('organization')
export class OrganizationController {
  constructor(private readonly orgs: OrganizationService) {}

  @Get()
  get(@CurrentOrg() org: OrgContext) {
    return this.orgs.get(org);
  }

  @Patch()
  @RequirePermission('settings.brand')
  update(@CurrentOrg() org: OrgContext, @Body() dto: UpdateOrganizationDto) {
    return this.orgs.update(org, dto);
  }

  @Post('logo')
  @RequirePermission('settings.brand')
  logo(@CurrentOrg() org: OrgContext, @Body() dto: UploadRequestDto) {
    return this.orgs.logoUpload(org, dto.contentType, dto.size);
  }

  @Post('logo/confirm')
  @RequirePermission('settings.brand')
  logoConfirm(@CurrentOrg() org: OrgContext, @Body() dto: UploadConfirmDto) {
    return this.orgs.logoConfirm(org, dto.key);
  }
}

@ApiTags('Equipo')
@OrgScoped()
@Controller('team')
export class TeamController {
  constructor(private readonly team: TeamService) {}

  @Get()
  @RequirePermission('settings.team')
  list(@CurrentOrg() org: OrgContext) {
    return this.team.list(org);
  }

  @Post('invitations')
  @RequirePermission('settings.team')
  invite(@CurrentOrg() org: OrgContext, @Body() dto: InviteMemberDto) {
    return this.team.invite(org, dto);
  }

  @Patch('members/:id')
  @RequirePermission('settings.team')
  update(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateMemberDto) {
    return this.team.update(org, id, dto);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @RequirePermission('settings.team')
  async remove(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.team.remove(org, id);
  }

  @Post('members/:id/resend-invitation')
  @HttpCode(204)
  @RequirePermission('settings.team')
  async resend(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.team.resendInvitation(org, id);
  }
}

@ApiTags('Equipo')
@OrgScoped()
@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get()
  @RequirePermission('settings.team')
  list(@CurrentOrg() org: OrgContext) {
    return this.roles.list(org);
  }

  @Post()
  @RequirePermission('settings.team')
  create(@CurrentOrg() org: OrgContext, @Body() dto: CreateRoleDto) {
    return this.roles.create(org, dto);
  }

  @Patch(':id')
  @RequirePermission('settings.team')
  update(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRoleDto) {
    return this.roles.update(org, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @RequirePermission('settings.team')
  async remove(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string) {
    await this.roles.remove(org, id);
  }
}

@ApiTags('Equipo')
@OrgScoped()
@Controller('permissions')
export class PermissionsCatalogController {
  @Get()
  list() {
    return ORG_PERMISSIONS;
  }
}
