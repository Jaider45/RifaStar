import { Global, Module } from '@nestjs/common';
import { env } from '../../config/env';
import { FakeMailProvider, MailProvider, SmtpMailProvider } from './mail.provider';

@Global()
@Module({
  providers: [{ provide: MailProvider, useClass: env().MAIL_DRIVER === 'fake' ? FakeMailProvider : SmtpMailProvider }],
  exports: [MailProvider],
})
export class MailModule {}
