import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { BillingController, BillingWebhookController } from './billing.controller';
import { BillingProvider, FakeBillingProvider, StripeBillingProvider } from './billing.provider';
import { BillingService } from './billing.service';

@Global()
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [
    { provide: BillingProvider, useClass: env().BILLING_DRIVER === 'stripe' ? StripeBillingProvider : FakeBillingProvider },
    BillingService,
  ],
  exports: [BillingService, BillingProvider],
})
export class BillingModule {}
