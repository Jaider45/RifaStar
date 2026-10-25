import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PlatformRole } from '@prisma/client';
import type { AuthPrincipal } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators';
import { Errors } from '../common/errors';
import { ORG_PERMISSIONS, PLATFORM_PERMISSIONS } from '../permissions/catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { PlatformScoped, RequirePlatformPermission } from '../permissions/decorators';
import {
  AuditQuery,
  ChangePasswordDto,
  CreateOrgDto,
  CreatePlanDto,
  CreatePlatformUserDto,
  ListOrgsQuery,
  ManualSubscriptionDto,
  PlatformPermissionsDto,
  ReasonDto,
  SubscriptionsQuery,
  SupportSessionDto,
  TemplatePermissionsDto,
  TrialConfigDto,
  UpdateOrgDto,
  UpdatePlanDto,
  UpdatePlatformUserDto,
} from './platform.dto';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformOrgsService } from './platform-orgs.service';

const platformUser = (auth: AuthPrincipal) => {
  if (auth.kind !== 'platform') throw Errors.forbidden();
  return auth;
};

@ApiTags('Plataforma · Organizaciones')
@PlatformScoped()
@Controller('platform')
export class PlatformOrgsController {
  constructor(
    private readonly orgs: PlatformOrgsService,
    private readonly permissions: PermissionsService,
  ) {}

  @Get('stats')
  @RequirePlatformPermission('platform.orgs.read')
  async stats(@CurrentAuth() auth: AuthPrincipal) {
    const granted = await this.permissions.platformPermissions(platformUser(auth).role);
    return this.orgs.stats(granted.has('platform.billing.read'));
  }

  @Get('orgs')
  @RequirePlatformPermission('platform.orgs.read')
  list(@Query() query: ListOrgsQuery) {
    return this.orgs.list(query);
  }

  @Get('orgs/:id')
  @RequirePlatformPermission('platform.orgs.read')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.detail(id);
  }

  @Post('orgs')
  @RequirePlatformPermission('platform.orgs.write')
  create(@Body() dto: CreateOrgDto) {
    return this.orgs.create(dto);
  }

  @Patch('orgs/:id')
  @RequirePlatformPermission('platform.orgs.write')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrgDto) {
    return this.orgs.update(id, dto);
  }

  @Post('orgs/:id/suspend')
  @HttpCode(200)
  @RequirePlatformPermission('platform.orgs.write')
  suspend(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReasonDto) {
    return this.orgs.suspend(id, dto.reason);
  }

  @Post('orgs/:id/reactivate')
  @HttpCode(200)
  @RequirePlatformPermission('platform.orgs.write')
  reactivate(@Param('id', ParseUUIDPipe) id: string) {
    return this.orgs.reactivate(id);
  }

  @Put('orgs/:id/subscription')
  @RequirePlatformPermission('platform.billing.write')
  subscription(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ManualSubscriptionDto) {
    return this.orgs.setSubscription(id, dto);
  }

  @Post('orgs/:id/support-sessions')
  @RequirePlatformPermission('platform.impersonate')
  support(@CurrentAuth() auth: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SupportSessionDto) {
    return this.orgs.startSupport(platformUser(auth).platformUserId, id, dto.reason, dto.minutes);
  }

  @Delete('support-sessions/:id')
  @HttpCode(204)
  @RequirePlatformPermission('platform.impersonate')
  async endSupport(@Param('id', ParseUUIDPipe) id: string) {
    await this.orgs.endSupport(id);
  }
}

@ApiTags('Plataforma · Planes, roles y equipo')
@PlatformScoped()
@Controller('platform')
export class PlatformAdminController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get('plans')
  @RequirePlatformPermission('platform.orgs.read')
  plans() {
    return this.admin.plans();
  }

  @Post('plans')
  @RequirePlatformPermission('platform.plans.write')
  createPlan(@Body() dto: CreatePlanDto) {
    return this.admin.createPlan(dto);
  }

  @Patch('plans/:id')
  @RequirePlatformPermission('platform.plans.write')
  updatePlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto) {
    return this.admin.updatePlan(id, dto);
  }

  @Delete('plans/:id')
  @HttpCode(204)
  @RequirePlatformPermission('platform.plans.write')
  async archivePlan(@Param('id', ParseUUIDPipe) id: string) {
    await this.admin.archivePlan(id);
  }

  @Get('trial-config')
  @RequirePlatformPermission('platform.orgs.read')
  trialConfig() {
    return this.admin.trialConfig();
  }

  @Put('trial-config')
  @RequirePlatformPermission('platform.plans.write')
  updateTrialConfig(@CurrentAuth() auth: AuthPrincipal, @Body() dto: TrialConfigDto) {
    return this.admin.updateTrialConfig(platformUser(auth).platformUserId, dto);
  }

  /** Catálogo de permisos (organización y plataforma) para las matrices de roles. */
  @Get('permission-catalog')
  @RequirePlatformPermission('platform.roles.write')
  permissionCatalog() {
    return { organization: ORG_PERMISSIONS, platform: PLATFORM_PERMISSIONS };
  }

  @Get('role-templates')
  @RequirePlatformPermission('platform.roles.write')
  roleTemplates() {
    return this.admin.roleTemplates();
  }

  @Put('role-templates/:roleKey/permissions')
  @RequirePlatformPermission('platform.roles.write')
  setTemplate(@Param('roleKey') roleKey: string, @Body() dto: TemplatePermissionsDto) {
    return this.admin.setTemplatePermissions(roleKey, dto.permissions);
  }

  @Get('team')
  @RequirePlatformPermission('platform.roles.write')
  team() {
    return this.admin.team();
  }

  @Post('team')
  @RequirePlatformPermission('platform.roles.write')
  addTeam(@Body() dto: CreatePlatformUserDto) {
    return this.admin.addPlatformUser(dto);
  }

  @Patch('team/:id')
  @RequirePlatformPermission('platform.roles.write')
  updateTeam(@CurrentAuth() auth: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlatformUserDto) {
    return this.admin.updatePlatformUser(platformUser(auth).platformUserId, id, dto);
  }

  @Put('role-permissions/:role')
  @RequirePlatformPermission('platform.roles.write')
  setRolePermissions(@Param('role') role: string, @Body() dto: PlatformPermissionsDto) {
    if (!(role in PlatformRole)) throw Errors.notFound('ese rol');
    return this.admin.setPlatformRolePermissions(role as PlatformRole, dto.permissions);
  }

  @Post('me/password')
  @HttpCode(204)
  async password(@CurrentAuth() auth: AuthPrincipal, @Body() dto: ChangePasswordDto) {
    await this.admin.changeOwnPassword(platformUser(auth).platformUserId, dto.currentPassword, dto.newPassword);
  }
}

@ApiTags('Plataforma · Facturación y actividad')
@PlatformScoped()
@Controller('platform')
export class PlatformBillingController {
  constructor(private readonly admin: PlatformAdminService) {}

  @Get('billing/subscriptions')
  @RequirePlatformPermission('platform.billing.read')
  subscriptions(@Query() q: SubscriptionsQuery) {
    return this.admin.subscriptions(q.status);
  }

  @Get('billing/failed-payments')
  @RequirePlatformPermission('platform.billing.read')
  failed() {
    return this.admin.failedPayments();
  }

  @Get('billing/events')
  @RequirePlatformPermission('platform.billing.read')
  events() {
    return this.admin.billingEvents();
  }

  @Post('billing/events/:id/retry')
  @HttpCode(200)
  @RequirePlatformPermission('platform.billing.write')
  retry(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.retryBillingEvent(id);
  }

  @Get('audit-logs')
  @RequirePlatformPermission('platform.orgs.read')
  audit(@Query() q: AuditQuery) {
    return this.admin.auditLogs(q);
  }
}
