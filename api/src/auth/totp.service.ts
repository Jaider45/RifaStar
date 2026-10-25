import { Injectable } from '@nestjs/common';
import { authenticator } from 'otplib';
import { decrypt, encrypt } from '../common/crypto';

authenticator.options = { window: 1, step: 30, digits: 6 };

@Injectable()
export class TotpService {
  /** Genera un secreto nuevo. Devuelve el secreto cifrado (para guardar) y el URL otpauth (para el QR). */
  generate(accountLabel: string): { secretEnc: string; otpauthUrl: string; secret: string } {
    const secret = authenticator.generateSecret(20);
    return {
      secret,
      secretEnc: encrypt(secret),
      otpauthUrl: authenticator.keyuri(accountLabel, 'Rifa Star', secret),
    };
  }

  verify(secretEnc: string | null | undefined, code: string | undefined): boolean {
    if (!secretEnc || !code) return false;
    try {
      return authenticator.verify({ token: code, secret: decrypt(secretEnc) });
    } catch {
      return false;
    }
  }
}
