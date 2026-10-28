import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors';
import { DatabaseService } from '../database/database.service';
import type { OrgContext } from '../tenancy/org-context';
import { TotpService } from './totp.service';

/**
 * Confirmación en el momento con el código de 2FA para acciones que deciden dinero o
 * ganadores (plan de seguridad, punto 3): la sesión abierta no basta.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly db: DatabaseService,
    private readonly totp: TotpService,
  ) {}

  async verify(org: OrgContext, code: string | undefined): Promise<void> {
    if (!org.memberId) throw Errors.forbidden();
    const member = await this.db.system.member.findUniqueOrThrow({ where: { id: org.memberId }, include: { user: true } });
    if (!member.user.totpEnabledAt) throw Errors.twoFactorSetupRequired();
    if (!(await this.totp.consume('user', member.user.id, member.user.totpSecretEnc, code))) throw Errors.twoFactorInvalid();
  }
}
