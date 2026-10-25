import { Module } from '@nestjs/common';
import { PlanPolicyHook } from './plan-hook';
import { RafflesController } from './raffles.controller';
import { RafflesService } from './raffles.service';

@Module({
  controllers: [RafflesController],
  providers: [RafflesService, PlanPolicyHook],
  exports: [RafflesService],
})
export class RafflesModule {}
