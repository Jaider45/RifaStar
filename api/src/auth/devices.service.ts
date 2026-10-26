import { Injectable, Logger } from '@nestjs/common';
import type { CookieOptions, Response } from 'express';
import { pepperedHash, randomToken, sha256 } from '../common/crypto';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { formatDrawDate } from '../common/dates';
import { env } from '../config/env';
import { DatabaseService } from '../database/database.service';
import { MailProvider } from './mail/mail.provider';
import { newDeviceMail } from './mail/templates';
import { TokensService } from './tokens.service';

export const DEVICE_COOKIE = 'rs_dev';

/** «Chrome en Windows», «Safari en iPhone»… (aproximado, solo para el aviso). */
export function describeDevice(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'equipo desconocido';
  return `${browser} en ${os}`;
}

/**
 * Equipos conocidos y sesiones (plan de seguridad, punto 2). Una cookie httpOnly
 * identifica el equipo; si alguien entra desde uno nuevo, la persona recibe un correo.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly mail: MailProvider,
    private readonly tokens: TokensService,
  ) {}

  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: env().COOKIE_SECURE, sameSite: 'lax', path: '/v1/auth', maxAge: 400 * 86_400_000 };
  }

  /**
   * Registra el inicio de sesión. Devuelve el id del equipo para la cookie. Avisa por correo
   * si el equipo es nuevo y la cuenta ya tenía otros (la primera vez no se avisa).
   */
  async recordLogin(userId: string, deviceCookie: string | undefined, res: Response): Promise<void> {
    const deviceId = deviceCookie && /^[A-Za-z0-9_-]{20,100}$/.test(deviceCookie) ? deviceCookie : randomToken(24);
    const deviceHash = pepperedHash(`device:${deviceId}`);
    const ctx = requestContext.get();
    const known = await this.db.system.knownDevice.findUnique({ where: { userId_deviceHash: { userId, deviceHash } } });
    if (known) {
      await this.db.system.knownDevice.update({ where: { id: known.id }, data: { lastSeenAt: new Date(), ip: ctx?.ip ?? null } });
    } else {
      const others = await this.db.system.knownDevice.count({ where: { userId } });
      await this.db.system.knownDevice.create({
        data: { userId, deviceHash, userAgent: ctx?.userAgent?.slice(0, 300) ?? null, ip: ctx?.ip ?? null },
      });
      if (others > 0) {
        const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
        await this.mail
          .send(
            newDeviceMail(
              user.email,
              formatDrawDate(new Date(), 'America/Bogota'),
              describeDevice(ctx?.userAgent),
              `${env().PUBLIC_BASE_URL}/admin/ajustes?tab=seguridad`,
            ),
          )
          .catch((err) => this.logger.warn(`No se pudo enviar el aviso de equipo nuevo: ${String(err)}`));
      }
    }
    res.cookie(DEVICE_COOKIE, deviceId, this.cookieOptions());
  }

  /** Sesiones abiertas: una por familia de refresh tokens vigente. */
  async sessions(userId: string, currentRefresh: string | undefined) {
    const currentFamily = currentRefresh
      ? (await this.db.system.refreshToken.findUnique({ where: { tokenHash: sha256(currentRefresh) } }))?.familyId
      : null;
    const live = await this.db.system.refreshToken.findMany({
      where: { userId, subjectType: 'user', revokedAt: null, rotatedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    const starts = await this.db.system.refreshToken.groupBy({
      by: ['familyId'],
      where: { familyId: { in: live.map((t) => t.familyId) } },
      _min: { createdAt: true },
    });
    return live.map((t) => ({
      id: t.familyId,
      device: describeDevice(t.userAgent),
      ip: t.ip,
      startedAt: starts.find((s) => s.familyId === t.familyId)?._min.createdAt ?? t.createdAt,
      lastUsedAt: t.createdAt,
      current: t.familyId === currentFamily,
    }));
  }

  async revoke(userId: string, familyId: string): Promise<void> {
    const owned = await this.db.system.refreshToken.count({ where: { familyId, userId } });
    if (!owned) throw Errors.notFound('la sesión');
    await this.tokens.revokeFamily(familyId);
  }

  /** Cierra todas las sesiones menos la actual. */
  async revokeOthers(userId: string, currentRefresh: string | undefined): Promise<number> {
    const current = currentRefresh ? await this.db.system.refreshToken.findUnique({ where: { tokenHash: sha256(currentRefresh) } }) : null;
    const res = await this.db.system.refreshToken.updateMany({
      where: { userId, revokedAt: null, ...(current && { familyId: { not: current.familyId } }) },
      data: { revokedAt: new Date() },
    });
    return res.count;
  }
}
