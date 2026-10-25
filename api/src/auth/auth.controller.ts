import { Body, Controller, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { RateLimit } from '../rate-limit/rate-limit';
import {
  AcceptInvitationDto,
  Disable2faDto,
  ForgotPasswordDto,
  LoginDto,
  ResetPasswordDto,
  SignupDto,
  TotpCodeDto,
} from './auth.dto';
import { AuthService, type SessionTokens } from './auth.service';
import type { AuthPrincipal } from './auth.types';
import { CurrentAuth, Public } from './decorators';
import { TokensService, USER_REFRESH_COOKIE } from './tokens.service';
import { Errors } from '../common/errors';

const userId = (auth: AuthPrincipal) => {
  if (auth.kind !== 'user') throw Errors.forbidden();
  return auth.userId;
};

@ApiTags('Autenticación')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  /** El refresh token solo viaja en la cookie httpOnly; el cuerpo lleva el access token. */
  private respond(res: Response, session: SessionTokens, extra: Record<string, unknown> = {}) {
    this.tokens.setRefreshCookie(res, 'user', session.refreshToken);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, ...extra };
  }

  @Public()
  @Post('signup')
  @RateLimit({ name: 'signup', by: ['ip'], limit: 10, windowSeconds: 3600 })
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: Response) {
    const { organizationId, ...session } = await this.auth.signup(dto);
    return this.respond(res, session, { organizationId });
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit(
    { name: 'login-ip', by: ['ip'], limit: 30, windowSeconds: 900 },
    { name: 'login-email', by: ['email'], limit: 10, windowSeconds: 900 },
  )
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    return this.respond(res, await this.auth.login(dto));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      return this.respond(res, await this.auth.refresh(req.cookies?.[USER_REFRESH_COOKIE]));
    } catch (err) {
      this.tokens.clearRefreshCookie(res, 'user');
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[USER_REFRESH_COOKIE]);
    this.tokens.clearRefreshCookie(res, 'user');
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.me(userId(auth));
  }

  @ApiBearerAuth()
  @Post('2fa/setup')
  setup2fa(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.setup2fa(userId(auth));
  }

  @ApiBearerAuth()
  @Post('2fa/enable')
  @HttpCode(204)
  async enable2fa(@CurrentAuth() auth: AuthPrincipal, @Body() dto: TotpCodeDto) {
    await this.auth.enable2fa(userId(auth), dto.code);
  }

  @ApiBearerAuth()
  @Post('2fa/disable')
  @HttpCode(204)
  async disable2fa(@CurrentAuth() auth: AuthPrincipal, @Body() dto: Disable2faDto) {
    await this.auth.disable2fa(userId(auth), dto.code, dto.password);
  }

  @Public()
  @Post('password/forgot')
  @HttpCode(202)
  @RateLimit({ name: 'forgot', by: ['email'], limit: 3, windowSeconds: 3600 }, { name: 'forgot-ip', by: ['ip'], limit: 20, windowSeconds: 3600 })
  async forgot(@Body() dto: ForgotPasswordDto) {
    await this.auth.forgotPassword(dto.email);
    return { message: 'Si el correo tiene una cuenta, te enviamos un enlace para restablecer la contraseña.' };
  }

  @Public()
  @Post('password/reset')
  @HttpCode(204)
  @RateLimit({ name: 'reset-ip', by: ['ip'], limit: 20, windowSeconds: 3600 })
  async reset(@Body() dto: ResetPasswordDto) {
    await this.auth.resetPassword(dto.token, dto.password);
  }
}

@ApiTags('Autenticación')
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokensService,
  ) {}

  @Public()
  @Get(':token')
  @RateLimit({ name: 'invite-view', by: ['ip'], limit: 60, windowSeconds: 3600 })
  preview(@Param('token') token: string) {
    return this.auth.previewInvitation(token);
  }

  @Public()
  @Post(':token/accept')
  @HttpCode(200)
  @RateLimit({ name: 'invite-accept', by: ['ip'], limit: 20, windowSeconds: 3600 })
  async accept(@Param('token') token: string, @Body() dto: AcceptInvitationDto, @Res({ passthrough: true }) res: Response) {
    const { organizationId, ...session } = await this.auth.acceptInvitation(token, dto);
    this.tokens.setRefreshCookie(res, 'user', session.refreshToken);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn, organizationId };
  }
}
