import { Global, Module } from '@nestjs/common';
import { OrgGuard } from './org.guard';
import { PermissionsService } from './permissions.service';
import { PlatformGuard } from './platform.guard';

@Global()
@Module({
  providers: [PermissionsService, OrgGuard, PlatformGuard],
  exports: [PermissionsService, OrgGuard, PlatformGuard],
})
export class PermissionsModule {}
