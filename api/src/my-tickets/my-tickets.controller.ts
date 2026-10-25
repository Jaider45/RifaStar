import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../auth/decorators';
import { Errors } from '../common/errors';
import { PublicAccessService } from '../public/public-access.service';
import { RateLimit } from '../rate-limit/rate-limit';
import { MyTicketsService } from './my-tickets.service';
import { ParticipantGuard } from './participant.guard';

class OtpRequestDto extends createZodDto(z.object({ phone: z.string().trim().min(7).max(20) })) {}
class OtpVerifyDto extends createZodDto(
  z.object({ phone: z.string().trim().min(7).max(20), code: z.string().trim().regex(/^\d{6}$/, 'El código tiene 6 dígitos.') }),
) {}

@ApiTags('Público · Mis boletos')
@Public()
@Controller('public/orgs/:orgSlug/my-tickets')
export class MyTicketsController {
  constructor(
    private readonly access: PublicAccessService,
    private readonly myTickets: MyTicketsService,
  ) {}

  @Post('otp')
  @HttpCode(202)
  @RateLimit(
    { name: 'otp-phone-min', by: ['phone'], limit: 1, windowSeconds: 60 },
    { name: 'otp-phone-hour', by: ['phone'], limit: 5, windowSeconds: 3600 },
    { name: 'otp-ip', by: ['ip'], limit: 20, windowSeconds: 3600 },
  )
  async otp(@Param('orgSlug') orgSlug: string, @Body() dto: OtpRequestDto) {
    await this.myTickets.requestOtp(await this.access.org(orgSlug), dto.phone);
    return { message: 'Si tienes boletos con ese número, te enviamos un código por WhatsApp.' };
  }

  @Post('verify')
  @HttpCode(200)
  @RateLimit({ name: 'otp-verify-ip', by: ['ip'], limit: 30, windowSeconds: 3600 }, { name: 'otp-verify-phone', by: ['phone'], limit: 10, windowSeconds: 3600 })
  async verify(@Param('orgSlug') orgSlug: string, @Body() dto: OtpVerifyDto) {
    return this.myTickets.verifyOtp(await this.access.org(orgSlug), dto.phone, dto.code);
  }

  @Get()
  @ApiBearerAuth()
  @UseGuards(ParticipantGuard)
  @RateLimit({ name: 'my-tickets', by: ['ip'], limit: 60, windowSeconds: 60 })
  async view(@Param('orgSlug') orgSlug: string, @Req() req: Request) {
    const org = await this.access.org(orgSlug);
    const auth = req.auth;
    if (auth?.kind !== 'participant' || auth.organizationId !== org.id) throw Errors.authRequired();
    return this.myTickets.view(org, auth.participantId);
  }
}
