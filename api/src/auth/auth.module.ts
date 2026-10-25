import { Global, Module } from '@nestjs/common';
import { AuthController, InvitationsController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
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
  controllers: [AuthController, InvitationsController, PlatformAuthController, PlatformMeController],
  providers: [AuthService, PlatformAuthService, TokensService, PasswordService, TotpService, UsersService, AuthGuard],
  exports: [TokensService, PasswordService, TotpService, UsersService, AuthGuard],
})
export class AuthModule {}
