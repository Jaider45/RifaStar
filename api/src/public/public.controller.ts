import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query, Req, Res } from '@nestjs/common';
import { ApiHeader, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { ReceiptConfirmDto, ReceiptRequestDto, ReserveDto } from '../orders/orders.dto';
import { OrdersService } from '../orders/orders.service';
import { ReservationService } from '../orders/reservation.service';
import { RateLimit } from '../rate-limit/rate-limit';
import { ResultsService } from '../results/results.service';
import { RankingService } from '../ranking/ranking.service';
import { PERIOD_PARAM_RE } from '../ranking/periods';
import { Errors } from '../common/errors';
import { PublicAccessService } from './public-access.service';
import { PublicRafflesService } from './public-raffles.service';

class NumbersQuery extends createZodDto(z.object({ status: z.enum(['all', 'available']).default('all') })) {}
class NotifyMeDto extends createZodDto(
  z.object({ name: z.string().trim().min(2).max(80), phone: z.string().trim().min(7).max(20) }),
) {}

class RankingQuery extends createZodDto(z.object({ period: z.string().default('current') })) {}

const IDEMPOTENCY_RE = /^[\w-]{8,100}$/;

@ApiTags('Público')
@Public()
@Controller('public')
export class PublicController {
  constructor(
    private readonly access: PublicAccessService,
    private readonly raffles: PublicRafflesService,
    private readonly reservations: ReservationService,
    private readonly orders: OrdersService,
    private readonly results: ResultsService,
    private readonly ranking: RankingService,
  ) {}

  /** Dominio propio → organización (para que el frontend sirva rifas.tunegocio.com). */
  @Get('domains/:host')
  @RateLimit({ name: 'pub-domain', by: ['ip'], limit: 120, windowSeconds: 60 })
  async domain(@Param('host') host: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'public, max-age=300');
    return this.access.byDomain(host);
  }

  @Get('orgs/:orgSlug/ranking')
  @RateLimit({ name: 'pub-ranking', by: ['ip'], limit: 120, windowSeconds: 60 })
  async rankingPublic(@Param('orgSlug') orgSlug: string, @Query() query: RankingQuery, @Res({ passthrough: true }) res: Response) {
    if (!PERIOD_PARAM_RE.test(query.period)) throw Errors.validation({ field: 'period' }, 'Usa «current», AAAA-MM o AAAA-MM-DD.');
    const org = await this.access.org(orgSlug);
    res.setHeader('Cache-Control', 'public, max-age=30');
    return this.ranking.publicRanking(org.id, query.period);
  }

  @Get('orgs/:orgSlug/raffles/:raffleSlug/results')
  @RateLimit({ name: 'pub-results', by: ['ip'], limit: 120, windowSeconds: 60 })
  async raffleResults(@Param('orgSlug') orgSlug: string, @Param('raffleSlug') raffleSlug: string, @Res({ passthrough: true }) res: Response) {
    const org = await this.access.org(orgSlug);
    res.setHeader('Cache-Control', 'public, max-age=30');
    return this.results.publicResults(org.id, raffleSlug, org.timezone);
  }

  @Get('orgs/:orgSlug/raffles/:raffleSlug')
  @RateLimit({ name: 'pub-raffle', by: ['ip'], limit: 120, windowSeconds: 60 })
  async raffle(@Param('orgSlug') orgSlug: string, @Param('raffleSlug') raffleSlug: string, @Res({ passthrough: true }) res: Response) {
    const org = await this.access.org(orgSlug);
    res.setHeader('Cache-Control', 'public, max-age=15, stale-while-revalidate=30');
    return this.raffles.raffle(org, raffleSlug);
  }

  @Get('orgs/:orgSlug/raffles/:raffleSlug/numbers')
  @RateLimit({ name: 'pub-numbers', by: ['ip'], limit: 240, windowSeconds: 60 })
  async numbers(
    @Param('orgSlug') orgSlug: string,
    @Param('raffleSlug') raffleSlug: string,
    @Query() query: NumbersQuery,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const org = await this.access.org(orgSlug);
    const grid = await this.raffles.numbers(org, raffleSlug, query.status);
    res.setHeader('Cache-Control', 'public, max-age=3');
    res.setHeader('ETag', grid.etag);
    if (req.header('if-none-match') === grid.etag) {
      res.status(304);
      return undefined;
    }
    const { etag: _etag, ...body } = grid;
    return body;
  }

  @Post('orgs/:orgSlug/raffles/:raffleSlug/orders')
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @RateLimit(
    { name: 'pub-order-ip', by: ['ip'], limit: 30, windowSeconds: 600 },
    { name: 'pub-order-phone', by: ['phone'], limit: 10, windowSeconds: 600 },
  )
  async reserve(
    @Param('orgSlug') orgSlug: string,
    @Param('raffleSlug') raffleSlug: string,
    @Body() dto: ReserveDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const org = await this.access.org(orgSlug);
    const key = idempotencyKey && IDEMPOTENCY_RE.test(idempotencyKey) ? idempotencyKey : undefined;
    return this.reservations.reserve(org.id, raffleSlug, dto, key);
  }

  @Get('orders/:id')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-order-view', by: ['ip'], limit: 120, windowSeconds: 60 })
  async order(@Param('id', ParseUUIDPipe) id: string, @Headers('x-order-token') token?: string) {
    const orgId = await this.access.order(id, token);
    return this.orders.publicStatus(orgId, id);
  }

  @Post('orders/:id/receipt')
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-receipt', by: ['ip'], limit: 30, windowSeconds: 600 })
  async receipt(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiptRequestDto, @Headers('x-order-token') token?: string) {
    const orgId = await this.access.order(id, token);
    return this.orders.receiptUpload(orgId, id, dto.contentType, dto.size);
  }

  @Post('orders/:id/receipt/confirm')
  @HttpCode(200)
  @ApiHeader({ name: 'X-Order-Token', required: true })
  @RateLimit({ name: 'pub-receipt-confirm', by: ['ip'], limit: 30, windowSeconds: 600 })
  async receiptConfirm(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceiptConfirmDto, @Headers('x-order-token') token?: string) {
    const orgId = await this.access.order(id, token);
    return this.orders.receiptConfirm(orgId, id, dto.key);
  }

  @Post('orgs/:orgSlug/notify-me')
  @HttpCode(200)
  @RateLimit(
    { name: 'pub-notify-ip', by: ['ip'], limit: 20, windowSeconds: 3600 },
    { name: 'pub-notify-phone', by: ['phone'], limit: 5, windowSeconds: 3600 },
  )
  async notifyMe(@Param('orgSlug') orgSlug: string, @Body() dto: NotifyMeDto) {
    return this.raffles.notifyMe(await this.access.org(orgSlug), dto);
  }
}
