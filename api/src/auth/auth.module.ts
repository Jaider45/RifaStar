import { Global, Module } from '@nestjs/common';
import { AuthController, InvitationsController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { DevicesService } from './devices.service';
import { StepUpService } from './step-up.service';
import { MyPhoneController, SessionsController } from './me.controller';
import { MailModule } from './mail/mail.module';
import { PasswordService } from './password.service';
import { PlatformAuthController, PlatformMeController } from './platform-auth.controller';
import { PlatformAuthService } from './platform-auth.service';
import { TokensService } from './tokens.service';
import { TotpService } from './totp.service';
import { UsersService } from './users.service';

@Global()
@Module({
  imports: [MailModule],
  controllers: [AuthController, InvitationsController, SessionsController, MyPhoneController, PlatformAuthController, PlatformMeController],
  providers: [AuthService, PlatformAuthService, TokensService, PasswordService, TotpService, UsersService, DevicesService, StepUpService, AuthGuard],
  exports: [TokensService, PasswordService, TotpService, UsersService, DevicesService, StepUpService, AuthGuard],
})
export class AuthModule {}
