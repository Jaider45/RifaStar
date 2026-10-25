import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { PlatformScoped } from '../permissions/decorators';
import { RateLimit } from '../rate-limit/rate-limit';
import { PlatformChallengeDto, PlatformLoginDto, PlatformVerifyDto } from './auth.dto';
import type { AuthPrincipal } from './auth.types';
import { CurrentAuth, Public } from './decorators';
import { PlatformAuthService } from './platform-auth.service';
import { PLATFORM_REFRESH_COOKIE, TokensService } from './tokens.service';

@ApiTags('Plataforma · Autenticación')
@Controller('platform/auth')
export class PlatformAuthController {
  constructor(
    private readonly auth: PlatformAuthService,
    private readonly tokens: TokensService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @RateLimit(
    { name: 'plat-login-ip', by: ['ip'], limit: 20, windowSeconds: 900 },
    { name: 'plat-login-email', by: ['email'], limit: 5, windowSeconds: 900 },
  )
  login(@Body() dto: PlatformLoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Public()
  @Post('2fa/enroll')
  @HttpCode(200)
  enroll(@Body() dto: PlatformChallengeDto) {
    return this.auth.enroll(dto.challengeToken);
  }

  @Public()
  @Post('2fa/verify')
  @HttpCode(200)
  @RateLimit({ name: 'plat-2fa-ip', by: ['ip'], limit: 20, windowSeconds: 900 })
  async verify(@Body() dto: PlatformVerifyDto, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.verify(dto.challengeToken, dto.code);
    this.tokens.setRefreshCookie(res, 'platform_user', session.refreshToken);
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      const session = await this.auth.refresh(req.cookies?.[PLATFORM_REFRESH_COOKIE]);
      this.tokens.setRefreshCookie(res, 'platform_user', session.refreshToken);
      return { accessToken: session.accessToken, expiresIn: session.expiresIn };
    } catch (err) {
      this.tokens.clearRefreshCookie(res, 'platform_user');
      throw err;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[PLATFORM_REFRESH_COOKIE];
    if (token) await this.tokens.revokeByToken(token);
    this.tokens.clearRefreshCookie(res, 'platform_user');
  }
}

@ApiTags('Plataforma · Autenticación')
@PlatformScoped()
@Controller('platform')
export class PlatformMeController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Get('me')
  me(@CurrentAuth() auth: AuthPrincipal) {
    return this.auth.me(auth.kind === 'platform' ? auth.platformUserId : '');
  }
}
