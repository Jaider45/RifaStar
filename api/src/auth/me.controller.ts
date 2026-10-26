import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { pepperedHash, safeEqual } from '../common/crypto';
import { AppError, Errors } from '../common/errors';
import { normalizePhone } from '../common/phone';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { MessagesService } from '../messaging/messages.service';
import { CurrentOrg, OrgScoped } from '../permissions/decorators';
import { RateLimit } from '../rate-limit/rate-limit';
import { RedisService } from '../redis/redis.service';
import type { OrgContext } from '../tenancy/org-context';
import type { AuthPrincipal } from './auth.types';
import { CurrentAuth } from './decorators';
import { DevicesService } from './devices.service';
import { USER_REFRESH_COOKIE } from './tokens.service';

class PhoneDto extends createZodDto(z.object({ phone: z.string().trim().min(7).max(20) })) {}
class PhoneCodeDto extends createZodDto(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos.') })) {}

const userId = (auth: AuthPrincipal) => {
  if (auth.kind !== 'user') throw Errors.forbidden();
  return auth.userId;
};

const PHONE_TTL_SECONDS = 600;
const MAX_ATTEMPTS = 5;

/** Sesiones abiertas de la persona (plan de seguridad, punto 2). */
@ApiTags('Autenticación')
@ApiBearerAuth()
@Controller('auth/sessions')
export class SessionsController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(@CurrentAuth() auth: AuthPrincipal, @Req() req: Request) {
    return this.devices.sessions(userId(auth), req.cookies?.[USER_REFRESH_COOKIE]);
  }

  @Delete(':id')
  @HttpCode(204)
  async revoke(@CurrentAuth() auth: AuthPrincipal, @Param('id', ParseUUIDPipe) id: string) {
    await this.devices.revoke(userId(auth), id);
  }

  @Post('revoke-others')
  @HttpCode(200)
  async revokeOthers(@CurrentAuth() auth: AuthPrincipal, @Req() req: Request) {
    return { closed: await this.devices.revokeOthers(userId(auth), req.cookies?.[USER_REFRESH_COOKIE]) };
  }
}

/**
 * WhatsApp del gestor para los avisos de resultados y ganadores. Se confirma con un código
 * que llega a ese número (se envía con la organización activa).
 */
@ApiTags('Autenticación')
@OrgScoped()
@Controller('me/phone')
export class MyPhoneController {
  constructor(
    private readonly db: DatabaseService,
    private readonly redis: RedisService,
    private readonly messages: MessagesService,
  ) {}

  private key(uid: string) {
    return `phone-verify:${uid}`;
  }

  @Post()
  @HttpCode(202)
  @RateLimit({ name: 'phone-verify-ip', by: ['ip'], limit: 10, windowSeconds: 3600 }, { name: 'phone-verify-phone', by: ['phone'], limit: 3, windowSeconds: 3600 })
  async start(@CurrentAuth() auth: AuthPrincipal, @CurrentOrg() org: OrgContext, @Body() dto: PhoneDto) {
    const uid = userId(auth);
    const phone = normalizePhone(dto.phone);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.redis.client.set(this.key(uid), JSON.stringify({ phone, hash: pepperedHash(`phone:${uid}:${code}`), attempts: 0 }), 'EX', PHONE_TTL_SECONDS);
    await this.messages.enqueue(org.id, 'phone_verify_code', phone, { code }, { idempotencyKey: `phone-verify:${uid}:${Date.now()}` });
    return {
      message: 'Te enviamos un código por WhatsApp. Escríbelo para confirmar el número.',
      expiresInSeconds: PHONE_TTL_SECONDS,
      // Solo en desarrollo, sin WhatsApp real: el código para poder probar.
      ...(env().NODE_ENV === 'development' && env().MESSAGING_DRIVER === 'fake' && { devCode: code }),
    };
  }

  @Post('verify')
  @HttpCode(200)
  @RateLimit({ name: 'phone-verify-check', by: ['ip'], limit: 20, windowSeconds: 600 })
  async verify(@CurrentAuth() auth: AuthPrincipal, @Body() dto: PhoneCodeDto) {
    const uid = userId(auth);
    const raw = await this.redis.client.get(this.key(uid));
    if (!raw) throw Errors.conflict('PHONE_CODE_EXPIRED', 'El código venció. Pide uno nuevo.');
    const state = JSON.parse(raw) as { phone: string; hash: string; attempts: number };
    if (state.attempts >= MAX_ATTEMPTS) {
      await this.redis.client.del(this.key(uid));
      throw new AppError('PHONE_CODE_LOCKED', 429, 'Hiciste demasiados intentos. Pide un código nuevo.');
    }
    if (!safeEqual(pepperedHash(`phone:${uid}:${dto.code}`), state.hash)) {
      await this.redis.client.set(this.key(uid), JSON.stringify({ ...state, attempts: state.attempts + 1 }), 'KEEPTTL');
      throw new AppError('PHONE_CODE_INVALID', 422, 'El código no es correcto.');
    }
    await this.redis.client.del(this.key(uid));
    await this.db.system.user.update({ where: { id: uid }, data: { phone: state.phone, phoneVerifiedAt: new Date() } });
    return { phone: state.phone, phoneVerified: true };
  }

  @Delete()
  @HttpCode(204)
  async remove(@CurrentAuth() auth: AuthPrincipal) {
    await this.db.system.user.update({ where: { id: userId(auth) }, data: { phone: null, phoneVerifiedAt: null } });
  }
}
