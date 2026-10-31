import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { BillingController, BillingWebhookController } from './billing.controller';
import { BillingProvider, FakeBillingProvider, StripeBillingProvider, WompiBillingProvider } from './billing.provider';
import { BillingService } from './billing.service';

const PROVIDERS = { stripe: StripeBillingProvider, wompi: WompiBillingProvider, fake: FakeBillingProvider } as const;

@Global()
@Module({
  controllers: [BillingController, BillingWebhookController],
  providers: [
    { provide: BillingProvider, useClass: PROVIDERS[env().BILLING_DRIVER] },
    BillingService,
  ],
  exports: [BillingService, BillingProvider],
})
export class BillingModule {}
