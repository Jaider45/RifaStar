import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { zEmail, zName, zOrgSlug, zPassword, zTotp } from '../common/zod';

export class SignupDto extends createZodDto(
  z.object({
    name: zName,
    email: zEmail,
    password: zPassword,
    organization: z.object({ name: zName, slug: zOrgSlug }),
  }),
) {}

export class LoginDto extends createZodDto(
  z.object({
    email: zEmail,
    password: z.string().min(1, 'Escribe tu contraseña.').max(200),
    totpCode: zTotp.optional(),
  }),
) {}

export class TotpCodeDto extends createZodDto(z.object({ code: zTotp })) {}

export class Disable2faDto extends createZodDto(
  z.object({ code: zTotp, password: z.string().min(1).max(200) }),
) {}

export class ForgotPasswordDto extends createZodDto(z.object({ email: zEmail })) {}

export class ResetPasswordDto extends createZodDto(
  z.object({ token: z.string().min(20).max(200), password: zPassword }),
) {}

export class AcceptInvitationDto extends createZodDto(
  z.object({ name: zName.optional(), password: z.string().min(1).max(200) }),
) {}

export class PlatformLoginDto extends createZodDto(
  z.object({ email: zEmail, password: z.string().min(1).max(200) }),
) {}

export class PlatformChallengeDto extends createZodDto(z.object({ challengeToken: z.string().min(10) })) {}

export class PlatformVerifyDto extends createZodDto(
  z.object({ challengeToken: z.string().min(10), code: zTotp }),
) {}
