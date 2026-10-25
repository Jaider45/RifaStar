import { Injectable, Logger } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../../config/env';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/** Proveedor de correo intercambiable (invitaciones y recuperación de contraseña). */
export abstract class MailProvider {
  abstract send(message: MailMessage): Promise<void>;
}

@Injectable()
export class SmtpMailProvider extends MailProvider {
  private readonly transporter: Transporter = nodemailer.createTransport(env().SMTP_URL);

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({ from: env().MAIL_FROM, ...message });
  }
}

/** Desarrollo y tests: guarda los correos en memoria. */
@Injectable()
export class FakeMailProvider extends MailProvider {
  private readonly logger = new Logger('FakeMail');
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<void> {
    this.outbox.push(message);
    this.logger.debug(`Correo simulado: «${message.subject}»`);
  }

  lastTo(email: string): MailMessage | undefined {
    return [...this.outbox].reverse().find((m) => m.to === email);
  }
}
