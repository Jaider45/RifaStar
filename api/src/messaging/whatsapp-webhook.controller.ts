import { Controller, Get, Headers, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { createHmac } from 'node:crypto';
import { Public } from '../auth/decorators';
import { safeEqual } from '../common/crypto';
import { AppError } from '../common/errors';
import { env } from '../config/env';
import { MessagesService } from './messages.service';

interface MetaWebhook {
  entry?: { changes?: { value?: { statuses?: { id: string; status: string; timestamp?: string; errors?: { title?: string }[] }[] } }[] }[];
}

export function verifyMetaSignature(raw: Buffer | undefined, header: string | undefined, secret: string): boolean {
  if (!raw || !header?.startsWith('sha256=') || !secret) return false;
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
  return safeEqual(expected, header);
}

/** Webhook de WhatsApp Cloud API: alta (GET) y estados de entrega (POST firmado). */
@ApiExcludeController()
@Public()
@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(private readonly messages: MessagesService) {}

  @Get()
  verify(@Query() q: Record<string, string>, @Res() res: Response) {
    if (q['hub.mode'] === 'subscribe' && env().WHATSAPP_VERIFY_TOKEN && q['hub.verify_token'] === env().WHATSAPP_VERIFY_TOKEN) {
      res.status(200).type('text/plain').send(q['hub.challenge']);
      return;
    }
    res.status(403).json({ code: 'WEBHOOK_VERIFY_FAILED', message: 'Token de verificación inválido.' });
  }

  @Post()
  @HttpCode(200)
  async receive(@Req() req: Request & { rawBody?: Buffer }, @Headers('x-hub-signature-256') signature?: string) {
    if (!verifyMetaSignature(req.rawBody, signature, env().WHATSAPP_APP_SECRET)) {
      throw new AppError('WEBHOOK_SIGNATURE_INVALID', 401, 'Firma del webhook inválida.');
    }
    const body = req.body as MetaWebhook;
    const statuses = body.entry?.flatMap((e) => e.changes?.flatMap((c) => c.value?.statuses ?? []) ?? []) ?? [];
    const updated = await this.messages.applyStatuses(statuses);
    return { received: statuses.length, updated };
  }
}
