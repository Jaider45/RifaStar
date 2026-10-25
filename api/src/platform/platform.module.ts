import { Module } from '@nestjs/common';
import { PlatformAdminController, PlatformBillingController, PlatformOrgsController } from './platform.controller';
import { PlatformAdminService } from './platform-admin.service';
import { PlatformOrgsService } from './platform-orgs.service';

@Module({
  controllers: [PlatformOrgsController, PlatformAdminController, PlatformBillingController],
  providers: [PlatformOrgsService, PlatformAdminService],
})
export class PlatformModule {}
