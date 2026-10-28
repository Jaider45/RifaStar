import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { decrypt, encrypt } from '../common/crypto';
import { DatabaseService } from '../database/database.service';

const STEP_SECONDS = 30;
authenticator.options = { window: 1, step: STEP_SECONDS, digits: 6 };

@Injectable()
export class TotpService {
  constructor(private readonly db: DatabaseService) {}

  /** Genera un secreto nuevo. Devuelve el secreto cifrado (para guardar) y el URL otpauth (para el QR). */
  generate(accountLabel: string): { secretEnc: string; otpauthUrl: string; secret: string } {
    const secret = authenticator.generateSecret(20);
    return {
      secret,
      secretEnc: encrypt(secret),
      otpauthUrl: authenticator.keyuri(accountLabel, 'Rifa Star', secret),
    };
  }

  /**
   * Valida el código y lo consume: cada código sirve una sola vez por cuenta (RFC 6238 §5.2).
   * Se guarda el paso de tiempo aceptado y solo se aceptan pasos posteriores, así un código
   * visto u oído no se puede reusar durante su ventana de tolerancia (±30 s).
   */
  async consume(kind: 'user' | 'platform', id: string, secretEnc: string | null | undefined, code: string | undefined): Promise<boolean> {
    const step = this.matchStep(secretEnc, code);
    if (step === null) return false;
    const updated =
      kind === 'user'
        ? await this.db.system.$executeRaw`
            UPDATE users SET totp_last_step = ${step}
             WHERE id = ${id}::uuid AND (totp_last_step IS NULL OR totp_last_step < ${step})`
        : await this.db.system.$executeRaw`
            UPDATE platform_users SET totp_last_step = ${step}
             WHERE id = ${id}::uuid AND (totp_last_step IS NULL OR totp_last_step < ${step})`;
    return updated === 1;
  }

  /** Paso de tiempo al que corresponde el código (actual, anterior o siguiente), o null si no es válido. */
  private matchStep(secretEnc: string | null | undefined, code: string | undefined): number | null {
    if (!secretEnc || !code) return null;
    try {
      const delta = authenticator.checkDelta(code, decrypt(secretEnc));
      return delta === null ? null : Math.floor(Date.now() / 1000 / STEP_SECONDS) + delta;
    } catch {
      return null;
    }
  }
}
