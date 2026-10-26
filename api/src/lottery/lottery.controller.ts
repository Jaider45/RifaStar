import { Controller, Get, Headers, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { Public } from '../auth/decorators';
import { safeEqual } from '../common/crypto';
import { AppError } from '../common/errors';
import { env } from '../config/env';
import { OrgScoped, RequirePermission } from '../permissions/decorators';
import type { ProviderResult } from './lottery.provider';
import { LotteryService } from './lottery.service';

/** Firma HMAC-SHA256 del cuerpo, en hex (con o sin prefijo «sha256=»). */
export function verifyLotterySignature(raw: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!raw || !header || !secret) return false;
  const expected = createHmac('sha256', secret).update(raw).digest('hex');
  return safeEqual(expected, header.replace(/^sha256=/, '').trim().toLowerCase());
}

@ApiTags('Loterías')
@OrgScoped()
@Controller('lotteries')
export class LotteriesController {
  constructor(private readonly lottery: LotteryService) {}

  /** Catálogo de loterías y chances para el selector del constructor. */
  @Get()
  @RequirePermission('raffles.view')
  catalog() {
    return this.lottery.catalog();
  }
}

/**
 * Webhook de LoteríaYa: avisa cuando hay número, cuando se verifica y si el operador lo
 * rectifica. La especificación exacta de la firma la envía LoteríaYa por correo: la cabecera
 * se configura con LOTERIAYA_SIGNATURE_HEADER.
 */
@Public()
@Controller('webhooks/loteriaya')
export class LotteryWebhookController {
  constructor(private readonly lottery: LotteryService) {}

  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers() headers: Record<string, string | undefined>) {
    const signature = headers[env().LOTERIAYA_SIGNATURE_HEADER.toLowerCase()];
    if (!verifyLotterySignature(req.rawBody, signature, env().LOTERIAYA_WEBHOOK_SECRET)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 401, 'Firma del webhook inválida.');
    }
    const body = req.body as { result?: ProviderResult; results?: ProviderResult[]; data?: ProviderResult } & Partial<ProviderResult>;
    const results = body.results ?? (body.result ? [body.result] : body.data ? [body.data] : body.draw ? [body as ProviderResult] : []);
    const changed = await this.lottery.ingest(results);
    return { received: results.length, changed: changed.length };
  }
}
