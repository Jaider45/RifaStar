import { Global, Module } from '@nestjs/common';
import { PlanPolicyService } from './plan-policy.service';

@Global()
@Module({ providers: [PlanPolicyService], exports: [PlanPolicyService] })
export class PlansModule {}
