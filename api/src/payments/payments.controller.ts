import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators';
import { CurrentOrg, OrgScoped, RequirePermission } from '../permissions/decorators';
import { PublicAccessService } from '../public/public-access.service';
import { RateLimit } from '../rate-limit/rate-limit';
import type { OrgContext } from '../tenancy/org-context';
import { GatewayAccountsService } from './gateway-accounts.service';
import { GatewayPaymentsService } from './gateway-payments.service';
import { ConnectGatewayDto, ListOnlinePaymentsQuery, PayOrderDto, RefundDoneDto, UpdateGatewayDto } from './payments.dto';
import type { WompiEvent } from './wompi/types';

/** Pagos en línea desde el panel: conectar la cuenta de Wompi y ver lo que se cobró. */
@ApiTags('Pagos en línea')
@OrgScoped()
@Controller('payments/gateway')
export class GatewayController {
  constructor(
    private readonly accounts: GatewayAccountsService,
    private readonly payments: GatewayPaymentsService,
  ) {}

  @Get()
  @RequirePermission('settings.brand')
  get(@CurrentOrg() org: OrgContext) {
    return this.accounts.get(org);
  }

  @Put()
  @HttpCode(200)
  @RequirePermission('settings.brand')
  connect(@CurrentOrg() org: OrgContext, @Body() dto: ConnectGatewayDto) {
    return this.accounts.connect(org, dto);
  }

  @Patch()
  @RequirePermission('settings.brand')
  update(@CurrentOrg() org: OrgContext, @Body() dto: UpdateGatewayDto) {
    return this.accounts.update(org, dto);
  }

  @Get('transactions')
  @RequirePermission('payments.view')
  transactions(@CurrentOrg() org: OrgContext, @Query() query: ListOnlinePaymentsQuery) {
    return this.payments.list(org, query);
  }

  @Post('transactions/:id/refunded')
  @HttpCode(200)
  @RequirePermission('payments.release')
  refunded(@CurrentOrg() org: OrgContext, @Param('id', ParseUUIDPipe) id: string, @Body() dto: RefundDoneDto) {
    return this.payments.markRefunded(org, id, dto.note);
  }
}

/** Checkout propio del participante. Se autoriza con el token de la orden, igual que subir el comprobante. */
@ApiTags('Público')
@Public()
@Controller('public/orders/:id')
export class PublicCheckoutController {
  constructor(
    private readonly access: PublicAccessService,
    private readonly payments: GatewayPaymentsService,
  ) {}

  @Get('checkout')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-checkout', by: ['ip'], limit: 120, windowSeconds: 60 })
  async checkout(@Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') token?: string) {
    return this.payments.options(await this.access.order(id, token), id);
  }

  @Get('checkout/banks')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-checkout-banks', by: ['ip'], limit: 30, windowSeconds: 60 })
  async banks(@Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') token?: string) {
    return this.payments.banks(await this.access.order(id, token));
  }

  @Post('pay')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-pay-ip', by: ['ip'], limit: 20, windowSeconds: 600 })
  async pay(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PayOrderDto, @Headers('x-order-token') token?: string) {
    return this.payments.pay(await this.access.order(id, token), id, dto);
  }

  @Get('payment')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-payment-status', by: ['ip'], limit: 120, windowSeconds: 60 })
  async payment(@Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') token?: string) {
    return this.payments.status(await this.access.order(id, token), id);
  }
}

/**
 * Eventos de Wompi. Cada organización configura en su panel de Wompi la URL con el id de su
 * cuenta; la de Rifa Star (planes) es /platform. La firma se verifica con el secreto de eventos.
 */
@ApiTags('Webhooks')
@Public()
@Controller('webhooks/wompi')
export class WompiWebhookController {
  constructor(private readonly payments: GatewayPaymentsService) {}

  @Post('platform')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async platform(@Body() event: WompiEvent) {
    return { received: true, ...(await this.payments.handleEvent(null, event)) };
  }

  @Post(':accountId')
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async account(@Param('accountId', ParseUUIDPipe) accountId: string, @Body() event: WompiEvent) {
    return { received: true, ...(await this.payments.handleEvent(accountId, event)) };
  }
}
