import { Controller, Get, Param, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../auth/decorators';
import { formatDrawDate } from '../common/dates';
import { formatCop } from '../common/format';
import { env } from '../config/env';
import { RateLimit } from '../rate-limit/rate-limit';
import { PublicAccessService } from './public-access.service';
import { PublicRafflesService } from './public-raffles.service';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Vista previa al compartir por WhatsApp, Facebook o Telegram. La WebApp se arma en el
 * navegador y los bots de vista previa no ejecutan JavaScript: en producción el proxy
 * (Caddy) envía a los bots aquí. Una persona que abra esta URL sigue al sorteo.
 */
@ApiExcludeController()
@Public()
@Controller('public/share')
export class SharePreviewController {
  constructor(
    private readonly access: PublicAccessService,
    private readonly raffles: PublicRafflesService,
  ) {}

  @Get(':orgSlug/:raffleSlug')
  @RateLimit({ name: 'pub-share', by: ['ip'], limit: 120, windowSeconds: 60 })
  async preview(@Param('orgSlug') orgSlug: string, @Param('raffleSlug') raffleSlug: string, @Res() res: Response) {
    const org = await this.access.org(orgSlug);
    const data = await this.raffles.raffle(org, raffleSlug);
    const page = `${env().PUBLIC_BASE_URL}/${org.slug}/${data.raffle.slug}`;
    const title = `${data.raffle.title} · ${org.name}`;
    const description = `Cada número ${formatCop(data.raffle.pricePerNumber)} · Juega ${formatDrawDate(new Date(data.raffle.drawAt), org.timezone)} con ${data.raffle.lottery}. Elige tus números y paga por transferencia.`;
    const image = data.raffle.coverUrl ? `${env().PUBLIC_BASE_URL}/v1/public/share/${org.slug}/${data.raffle.slug}/cover` : null;
    res
      .status(200)
      .type('html')
      .setHeader('Cache-Control', 'public, max-age=300')
      .send(
        `<!doctype html><html lang="es"><head><meta charset="utf-8">` +
          `<title>${esc(title)}</title>` +
          `<meta name="description" content="${esc(description)}">` +
          `<meta property="og:type" content="website"><meta property="og:site_name" content="Rifa Star">` +
          `<meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}">` +
          `<meta property="og:url" content="${esc(page)}">` +
          (image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image">` : '') +
          `<meta http-equiv="refresh" content="0;url=${esc(page)}"></head>` +
          `<body><a href="${esc(page)}">${esc(title)}</a></body></html>`,
      );
  }

  /** Dirección estable de la portada: redirige a una URL firmada fresca (las firmadas vencen). */
  @Get(':orgSlug/:raffleSlug/cover')
  @RateLimit({ name: 'pub-share-cover', by: ['ip'], limit: 120, windowSeconds: 60 })
  async cover(@Param('orgSlug') orgSlug: string, @Param('raffleSlug') raffleSlug: string, @Res() res: Response) {
    const org = await this.access.org(orgSlug);
    const data = await this.raffles.raffle(org, raffleSlug);
    if (!data.raffle.coverUrl) {
      res.status(404).json({ code: 'NOT_FOUND', message: 'Este sorteo no tiene foto de portada.' });
      return;
    }
    res.setHeader('Cache-Control', 'public, max-age=600');
    res.redirect(302, data.raffle.coverUrl);
  }
}
