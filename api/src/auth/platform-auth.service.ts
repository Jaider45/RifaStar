import { Injectable } from '@nestjs/common';
import type { PlatformRole } from '@prisma/client';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { PermissionsService } from '../permissions/permissions.service';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';
import { TotpService } from './totp.service';

const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Login de plataforma en dos pasos. La contraseña solo entrega un token de
 * desafío; la sesión se emite después del código TOTP. Si el usuario aún no
 * configuró el 2FA, el desafío sirve para enrolarse primero.
 */
@Injectable()
export class PlatformAuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokensService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
  ) {}

  async login(email: string, password: string) {
    const user = await this.db.system.platformUser.findUnique({ where: { email } });
    const ok = await this.passwords.verify(user?.passwordHash, password);
    if (!user || !ok || user.disabledAt) throw Errors.invalidCredentials();
    return {
      challengeToken: this.tokens.signAccess({ typ: 'platform_challenge', sub: user.id }, CHALLENGE_TTL_SECONDS),
      needsEnrollment: !user.totpEnabledAt,
    };
  }

  private challengeUser(challengeToken: string): string {
    const claims = this.tokens.verifyAccess(challengeToken);
    if (claims.typ !== 'platform_challenge') throw Errors.sessionExpired();
    return claims.sub;
  }

  async enroll(challengeToken: string) {
    const user = await this.db.system.platformUser.findUniqueOrThrow({ where: { id: this.challengeUser(challengeToken) } });
    if (user.totpEnabledAt) throw Errors.conflict('2FA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa.');
    const generated = this.totp.generate(user.email);
    await this.db.system.platformUser.update({ where: { id: user.id }, data: { totpSecretEnc: generated.secretEnc } });
    return { otpauthUrl: generated.otpauthUrl, secret: generated.secret };
  }

  async verify(challengeToken: string, code: string) {
    const user = await this.db.system.platformUser.findUniqueOrThrow({ where: { id: this.challengeUser(challengeToken) } });
    if (user.disabledAt) throw Errors.invalidCredentials();
    if (!this.totp.verify(user.totpSecretEnc, code)) throw Errors.twoFactorInvalid();
    const now = new Date();
    await this.db.system.platformUser.update({
      where: { id: user.id },
      data: { lastLoginAt: now, totpEnabledAt: user.totpEnabledAt ?? now },
    });
    requestContext.patch({ actor: { type: 'platform_user', id: user.id } });
    await this.audit.recordSystem({ action: 'platform.login', entityType: 'platform_user', entityId: user.id });
    return this.session(user.id, user.role);
  }

  private async session(id: string, role: PlatformRole) {
    return {
      accessToken: this.tokens.signAccess({ typ: 'platform', sub: id, role }),
      refreshToken: await this.tokens.issueRefresh('platform_user', id),
      expiresIn: env().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async refresh(refreshToken: string | undefined) {
    if (!refreshToken) throw Errors.sessionExpired();
    const rotated = await this.tokens.rotateRefresh('platform_user', refreshToken);
    const user = await this.db.system.platformUser.findUnique({ where: { id: rotated.subjectId } });
    if (!user || user.disabledAt || !user.totpEnabledAt) throw Errors.sessionExpired();
    return {
      accessToken: this.tokens.signAccess({ typ: 'platform', sub: user.id, role: user.role }),
      refreshToken: rotated.token,
      expiresIn: env().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async me(platformUserId: string) {
    const user = await this.db.system.platformUser.findUniqueOrThrow({ where: { id: platformUserId } });
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      permissions: [...(await this.permissions.platformPermissions(user.role))],
    };
  }
}
