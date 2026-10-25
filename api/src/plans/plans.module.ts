import { Global, Module } from '@nestjs/common';
import { PlanGuard } from './plan.guard';
import { PlanPolicyService } from './plan-policy.service';

@Global()
@Module({ providers: [PlanPolicyService, PlanGuard], exports: [PlanPolicyService, PlanGuard] })
export class PlansModule {}
