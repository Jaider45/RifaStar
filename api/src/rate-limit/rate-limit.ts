import { type CanActivate, type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { sha256 } from '../common/crypto';
import { Errors } from '../common/errors';
import { tryNormalizePhone } from '../common/phone';
import { RedisService } from '../redis/redis.service';

export type RateLimitKey = 'ip' | 'phone' | 'email' | 'path';

export interface RateLimitRule {
  /** Nombre del bucket (p. ej. «order-create»). */
  name: string;
  /** Con qué se agrupan las solicitudes. */
  by: RateLimitKey[];
  limit: number;
  windowSeconds: number;
}

export const RATE_LIMITS = 'rs:rateLimits';
export const RateLimit = (...rules: RateLimitRule[]) => SetMetadata(RATE_LIMITS, rules);

@Injectable()
export class RateLimitService {
  constructor(private readonly redis: RedisService) {}

  /** Ventana fija con INCR + EXPIRE. Devuelve los segundos de espera si se excede. */
  async hit(key: string, limit: number, windowSeconds: number): Promise<number | null> {
    const redisKey = `rl:${key}`;
    const results = await this.redis.client.multi().incr(redisKey).expire(redisKey, windowSeconds, 'NX').ttl(redisKey).exec();
    const count = Number(results?.[0]?.[1] ?? 0);
    const ttl = Number(results?.[2]?.[1] ?? windowSeconds);
    return count > limit ? Math.max(ttl, 1) : null;
  }
}

function keyPart(req: Request, by: RateLimitKey): string | null {
  const body = (req.body ?? {}) as Record<string, unknown>;
  switch (by) {
    case 'ip':
      return req.ip ?? 'unknown';
    case 'phone': {
      const raw = typeof body.phone === 'string' ? body.phone : null;
      return raw ? (tryNormalizePhone(raw) ?? raw.replace(/\D/g, '')) : null;
    }
    case 'email':
      return typeof body.email === 'string' ? body.email.trim().toLowerCase() : null;
    case 'path':
      return req.path;
  }
}

/** Guard global: aplica las reglas @RateLimit de la ruta. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rules = this.reflector.get<RateLimitRule[] | undefined>(RATE_LIMITS, context.getHandler());
    if (!rules?.length) return true;
    const req = context.switchToHttp().getRequest<Request>();
    for (const rule of rules) {
      const parts = rule.by.map((b) => keyPart(req, b));
      if (parts.some((p) => p === null)) continue;
      const retryAfter = await this.limiter.hit(`${rule.name}:${sha256(parts.join('|'))}`, rule.limit, rule.windowSeconds);
      if (retryAfter !== null) {
        context.switchToHttp().getResponse<Response>().setHeader('Retry-After', String(retryAfter));
        throw Errors.rateLimited({ retryAfterSeconds: retryAfter });
      }
    }
    return true;
  }
}
