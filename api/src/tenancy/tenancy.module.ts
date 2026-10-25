import { Global, Module } from '@nestjs/common';
import { ProvisioningService } from './provisioning.service';

@Global()
@Module({ providers: [ProvisioningService], exports: [ProvisioningService] })
export class TenancyModule {}
