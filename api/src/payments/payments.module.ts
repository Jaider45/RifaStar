import { Global, Module } from '@nestjs/common';
import { wompiDriver } from '../config/env';
import { GatewayAccountsService } from './gateway-accounts.service';
import { GatewayPaymentsService } from './gateway-payments.service';
import { GatewayController, PublicCheckoutController, WompiWebhookController } from './payments.controller';
import { PlanBillingController } from './plan-billing.controller';
import { PlanBillingService } from './plan-billing.service';
import { SimulatedWompiController } from './wompi/simulated-wompi.controller';
import { FakeWompiClient, HttpWompiClient, WompiClient } from './wompi/wompi.client';

/**
 * Pagos en línea con Wompi por detrás del checkout propio de Rifa Star. Boletas: la cuenta de cada
 * organización. Planes: la cuenta de Rifa Star.
 */
@Global()
@Module({
  // La tokenización simulada solo existe con el driver simulado, que en producción nunca se activa.
  controllers: [GatewayController, PublicCheckoutController, WompiWebhookController, PlanBillingController, ...(wompiDriver() === 'fake' ? [SimulatedWompiController] : [])],
  providers: [
    { provide: WompiClient, useClass: wompiDriver() === 'wompi' ? HttpWompiClient : FakeWompiClient },
    GatewayAccountsService,
    GatewayPaymentsService,
    PlanBillingService,
  ],
  exports: [WompiClient, GatewayAccountsService, GatewayPaymentsService, PlanBillingService],
})
export class PaymentsModule {}
