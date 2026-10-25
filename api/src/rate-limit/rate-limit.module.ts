import { Global, Module } from '@nestjs/common';
import { RateLimitGuard, RateLimitService } from './rate-limit';

@Global()
@Module({ providers: [RateLimitService, RateLimitGuard], exports: [RateLimitService, RateLimitGuard] })
export class RateLimitModule {}
