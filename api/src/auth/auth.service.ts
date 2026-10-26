import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { pepperedHash, randomToken } from '../common/crypto';
import { Errors } from '../common/errors';
import { requestContext } from '../common/request-context';
import { env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { DatabaseService } from '../database/database.service';
import { needsTwoFactor } from '../permissions/catalog';
import { PermissionsService } from '../permissions/permissions.service';
import { ProvisioningService } from '../tenancy/provisioning.service';
import type { AcceptInvitationDto, LoginDto, SignupDto } from './auth.dto';
import { MailProvider } from './mail/mail.provider';
import { passwordResetMail } from './mail/templates';
import { PasswordService } from './password.service';
import { TokensService } from './tokens.service';
import { TotpService } from './totp.service';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly tokens: TokensService,
    private readonly passwords: PasswordService,
    private readonly totp: TotpService,
    private readonly provisioning: ProvisioningService,
    private readonly permissions: PermissionsService,
    private readonly audit: AuditService,
    private readonly mail: MailProvider,
  ) {}

  private async session(userId: string): Promise<SessionTokens> {
    return {
      accessToken: this.tokens.signAccess({ typ: 'user', sub: userId }),
      refreshToken: await this.tokens.issueRefresh('user', userId),
      expiresIn: env().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  /** Registro autoservicio (P1): crea el owner y su organización en prueba. */
  async signup(dto: SignupDto): Promise<SessionTokens & { organizationId: string; userId: string }> {
    const existing = await this.db.system.user.findUnique({ where: { email: dto.email } });
    if (existing) throw Errors.emailTaken();
    const passwordHash = await this.passwords.hash(dto.password);

    let result: { userId: string; organizationId: string };
    try {
      result = await this.db.system.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: dto.email, name: dto.name, passwordHash } });
        const org = await this.provisioning.createOrganization(
          { name: dto.organization.name, slug: dto.organization.slug, ownerUserId: user.id },
          tx,
        );
        requestContext.patch({ actor: { type: 'user', id: user.id } });
        await this.audit.recordSystem(
          { action: 'organization.signup', entityType: 'organization', entityId: org.id, organizationId: org.id, after: { slug: org.slug } },
          tx,
        );
        return { userId: user.id, organizationId: org.id };
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const target = String(err.meta?.target ?? '');
        throw target.includes('email') ? Errors.emailTaken() : Errors.slugTaken();
      }
      throw err;
    }
    return { ...(await this.session(result.userId)), organizationId: result.organizationId, userId: result.userId };
  }

  async login(dto: LoginDto): Promise<SessionTokens & { userId: string }> {
    const user = await this.db.system.user.findUnique({ where: { email: dto.email } });
    const ok = await this.passwords.verify(user?.passwordHash, dto.password);
    if (!user || !ok) throw Errors.invalidCredentials();
    if (user.totpEnabledAt) {
      if (!dto.totpCode) throw Errors.twoFactorRequired();
      if (!this.totp.verify(user.totpSecretEnc, dto.totpCode)) throw Errors.twoFactorInvalid();
    }
    await this.db.system.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return { ...(await this.session(user.id)), userId: user.id };
  }

  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    if (!refreshToken) throw Errors.sessionExpired();
    const rotated = await this.tokens.rotateRefresh('user', refreshToken);
    return {
      accessToken: this.tokens.signAccess({ typ: 'user', sub: rotated.subjectId }),
      refreshToken: rotated.token,
      expiresIn: env().ACCESS_TOKEN_TTL_SECONDS,
    };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    if (refreshToken) await this.tokens.revokeByToken(refreshToken);
  }

  async me(userId: string) {
    const user = await this.db.system.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: 'active' },
          include: { organization: true, role: { include: { permissions: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!user) throw Errors.sessionExpired();
    const memberships = user.memberships.map((m) => ({
      memberId: m.id,
      organization: { id: m.organization.id, slug: m.organization.slug, name: m.organization.name, status: m.organization.status },
      role: { id: m.role.id, key: m.role.key, name: m.role.name },
      sellerCode: m.sellerCode,
      permissions: [...this.permissions.roleKeys(m.role.key, m.role.organizationId, m.role.permissions)],
    }));
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      phoneVerified: Boolean(user.phoneVerifiedAt),
      twoFactorEnabled: Boolean(user.totpEnabledAt),
      // Algún rol suyo aprueba pagos, anuncia ganadores o maneja el equipo: el panel le pide activarla.
      twoFactorRequired: memberships.some((m) => needsTwoFactor(m.permissions)),
      memberships,
    };
  }

  async setup2fa(userId: string) {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) throw Errors.conflict('2FA_ALREADY_ENABLED', 'La verificación en dos pasos ya está activa.');
    const generated = this.totp.generate(user.email);
    await this.db.system.user.update({ where: { id: userId }, data: { totpSecretEnc: generated.secretEnc } });
    return { otpauthUrl: generated.otpauthUrl, secret: generated.secret };
  }

  async enable2fa(userId: string, code: string): Promise<void> {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.totpEnabledAt) return;
    if (!this.totp.verify(user.totpSecretEnc, code)) throw Errors.twoFactorInvalid();
    await this.db.system.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } });
  }

  async disable2fa(userId: string, code: string, password: string): Promise<void> {
    const user = await this.db.system.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await this.passwords.verify(user.passwordHash, password))) throw Errors.invalidCredentials();
    if (!this.totp.verify(user.totpSecretEnc, code)) throw Errors.twoFactorInvalid();
    await this.db.system.user.update({ where: { id: userId }, data: { totpEnabledAt: null, totpSecretEnc: null } });
  }

  /** Siempre responde igual, exista o no la cuenta. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.db.system.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return;
    const token = randomToken(32);
    await this.db.system.passwordResetToken.create({
      data: { userId: user.id, tokenHash: pepperedHash(token), expiresAt: new Date(Date.now() + 3_600_000) },
    });
    await this.mail.send(passwordResetMail(user.email, `${env().PUBLIC_BASE_URL}/restablecer/${token}`));
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const row = await this.db.system.passwordResetToken.findUnique({ where: { tokenHash: pepperedHash(token) } });
    if (!row || row.usedAt || row.expiresAt <= new Date()) {
      throw Errors.conflict('TOKEN_INVALID', 'El enlace ya no es válido. Pide uno nuevo.');
    }
    const passwordHash = await this.passwords.hash(password);
    await this.db.system.$transaction([
      this.db.system.passwordResetToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      this.db.system.user.update({ where: { id: row.userId }, data: { passwordHash } }),
    ]);
    await this.tokens.revokeAllForUser(row.userId);
  }

  private async findInvitation(token: string) {
    const member = await this.db.system.member.findUnique({
      where: { inviteTokenHash: pepperedHash(token) },
      include: { organization: true, role: true, user: true },
    });
    if (!member || member.status !== 'invited' || !member.inviteExpiresAt || member.inviteExpiresAt <= new Date()) {
      throw Errors.conflict('INVITATION_INVALID', 'La invitación ya no es válida. Pide que te la reenvíen.');
    }
    return member;
  }

  async previewInvitation(token: string) {
    const m = await this.findInvitation(token);
    return {
      organization: { name: m.organization.name, slug: m.organization.slug },
      role: { key: m.role.key, name: m.role.name },
      email: m.user.email,
      hasAccount: Boolean(m.user.passwordHash),
    };
  }

  /**
   * Acepta una invitación. Si la cuenta no tiene contraseña, la crea; si ya la
   * tiene, la contraseña confirma que es su dueño.
   */
  async acceptInvitation(token: string, dto: AcceptInvitationDto): Promise<SessionTokens & { organizationId: string; userId: string }> {
    const m = await this.findInvitation(token);
    if (m.user.passwordHash) {
      if (!(await this.passwords.verify(m.user.passwordHash, dto.password))) throw Errors.invalidCredentials();
    } else {
      if (dto.password.length < 10) {
        throw Errors.validation({ field: 'password' }, 'La contraseña debe tener al menos 10 caracteres.');
      }
      await this.db.system.user.update({
        where: { id: m.userId },
        data: { passwordHash: await this.passwords.hash(dto.password), name: dto.name ?? m.user.name },
      });
    }
    await this.db.system.$transaction(async (tx) => {
      await tx.member.update({
        where: { id: m.id },
        data: { status: 'active', joinedAt: new Date(), inviteTokenHash: null, inviteExpiresAt: null },
      });
      requestContext.patch({ actor: { type: 'user', id: m.userId } });
      await this.audit.recordSystem(
        { action: 'member.invitation_accepted', entityType: 'member', entityId: m.id, organizationId: m.organizationId },
        tx,
      );
    });
    return { ...(await this.session(m.userId)), organizationId: m.organizationId, userId: m.userId };
  }
}
