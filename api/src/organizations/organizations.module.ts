import { Module } from '@nestjs/common';
import {
  OrganizationController,
  PermissionsCatalogController,
  RolesController,
  TeamController,
} from './organizations.controller';
import { OrganizationService } from './organization.service';
import { RolesService } from './roles.service';
import { TeamService } from './team.service';

@Module({
  controllers: [OrganizationController, TeamController, RolesController, PermissionsCatalogController],
  providers: [OrganizationService, TeamService, RolesService],
  exports: [OrganizationService],
})
export class OrganizationsModule {}
