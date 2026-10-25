import { Injectable } from '@nestjs/common';
import type { SessionSubject } from '@prisma/client';
import type { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';
import { randomToken, sha256 } from '../common/crypto';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import type { AccessClaims, ParticipantClaims } from './auth.types';

const ISSUER = 'rifastar';
const AUDIENCE = 'rifastar-api';

export const USER_REFRESH_COOKIE = 'rs_rt';
export const PLATFORM_REFRESH_COOKIE = 'rs_prt';

const COOKIE_PATHS: Record<SessionSubject, string> = {
  user: '/v1/auth',
  platform_user: '/v1/platform/auth',
};

export const refreshCookieName = (subject: SessionSubject) =>
  subject === 'user' ? USER_REFRESH_COOKIE : PLATFORM_REFRESH_COOKIE;

@Injectable()
export class TokensService {
  constructor(private readonly db: DatabaseService) {}

  signAccess(claims: AccessClaims, ttlSeconds = env().ACCESS_TOKEN_TTL_SECONDS): string {
    return jwt.sign(claims, env().JWT_ACCESS_SECRET, {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
      issuer: ISSUER,
      audience: AUDIENCE,
    });
  }

  verifyAccess(token: string): AccessClaims {
    try {
      return jwt.verify(token, env().JWT_ACCESS_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: AUDIENCE,
      }) as AccessClaims;
    } catch {
      throw Errors.sessionExpired();
    }
  }

  signParticipant(claims: ParticipantClaims, ttlSeconds = 30 * 60): string {
    return jwt.sign(claims, env().JWT_PARTICIPANT_SECRET, {
      algorithm: 'HS256',
      expiresIn: ttlSeconds,
      issuer: ISSUER,
      audience: 'rifastar-participant',
    });
  }

  verifyParticipant(token: string): ParticipantClaims {
    try {
      const claims = jwt.verify(token, env().JWT_PARTICIPANT_SECRET, {
        algorithms: ['HS256'],
        issuer: ISSUER,
        audience: 'rifastar-participant',
      }) as ParticipantClaims;
      if (claims.typ !== 'participant') throw new Error('typ');
      return claims;
    } catch {
      throw Errors.sessionExpired(undefined);
    }
  }

  /** Emite un refresh token nuevo (en una familia nueva o existente). */
  async issueRefresh(subjectType: SessionSubject, subjectId: string, familyId: string = randomUUID()): Promise<string> {
    const token = randomToken(48);
    const ctx = requestContext.get();
    await this.db.system.refreshToken.create({
      data: {
        subjectType,
        userId: subjectType === 'user' ? subjectId : null,
        platformUserId: subjectType === 'platform_user' ? subjectId : null,
        familyId,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + env().REFRESH_TOKEN_TTL_DAYS * 86_400_000),
        ip: ctx?.ip ?? null,
        userAgent: ctx?.userAgent?.slice(0, 300) ?? null,
      },
    });
    return token;
  }

  /**
   * Rota un refresh token. Si el token ya fue usado (rotado o revocado), se
   * considera robado: se revoca toda la familia y se pide iniciar sesión.
   */
  async rotateRefresh(subjectType: SessionSubject, token: string): Promise<{ subjectId: string; token: string }> {
    const row = await this.db.system.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.subjectType !== subjectType) throw Errors.sessionExpired();

    const claimed = await this.db.system.refreshToken.updateMany({
      where: { id: row.id, rotatedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { rotatedAt: new Date() },
    });
    if (claimed.count !== 1) {
      if (row.rotatedAt || row.revokedAt) await this.revokeFamily(row.familyId);
      throw Errors.sessionExpired();
    }
    const subjectId = (row.userId ?? row.platformUserId)!;
    return { subjectId, token: await this.issueRefresh(subjectType, subjectId, row.familyId) };
  }

  async revokeByToken(token: string): Promise<void> {
    const row = await this.db.system.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (row) await this.revokeFamily(row.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.system.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.db.system.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  cookieOptions(subjectType: SessionSubject): CookieOptions {
    return {
      httpOnly: true,
      secure: env().COOKIE_SECURE,
      sameSite: 'lax',
      path: COOKIE_PATHS[subjectType],
      maxAge: env().REFRESH_TOKEN_TTL_DAYS * 86_400_000,
    };
  }

  setRefreshCookie(res: Response, subjectType: SessionSubject, token: string): void {
    res.cookie(refreshCookieName(subjectType), token, this.cookieOptions(subjectType));
  }

  clearRefreshCookie(res: Response, subjectType: SessionSubject): void {
    const { maxAge: _maxAge, ...opts } = this.cookieOptions(subjectType);
    res.clearCookie(refreshCookieName(subjectType), opts);
  }
}
