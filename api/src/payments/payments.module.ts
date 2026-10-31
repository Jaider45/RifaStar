import { Global, Module } from '@nestjs/common';
import { wompiDriver } from '../config/env';
import { GatewayAccountsService } from './gateway-accounts.service';
import { GatewayPaymentsService } from './gateway-payments.service';
import { GatewayController, PublicCheckoutController, WompiWebhookController } from './payments.controller';
import { PlanBillingController } from './plan-billing.controller';
import { PlanBillingService } from './plan-billing.service';
import { FakeWompiClient, HttpWompiClient, WompiClient } from './wompi/wompi.client';

/**
 * Pagos en línea con Wompi por detrás del checkout propio de Rifa Star. Boletas: la cuenta de cada
 * organización. Planes: la cuenta de Rifa Star.
 */
@Global()
@Module({
  controllers: [GatewayController, PublicCheckoutController, WompiWebhookController, PlanBillingController],
  providers: [
    { provide: WompiClient, useClass: wompiDriver() === 'wompi' ? HttpWompiClient : FakeWompiClient },
    GatewayAccountsService,
    GatewayPaymentsService,
    PlanBillingService,
  ],
  exports: [WompiClient, GatewayAccountsService, GatewayPaymentsService, PlanBillingService],
})
export class PaymentsModule {}
