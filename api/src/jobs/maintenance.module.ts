import { Global, Module } from '@nestjs/common';
import { RafflesModule } from '../raffles/raffles.module';
import { MaintenanceService } from './maintenance.service';

@Global()
@Module({ imports: [RafflesModule], providers: [MaintenanceService], exports: [MaintenanceService] })
export class MaintenanceModule {}
