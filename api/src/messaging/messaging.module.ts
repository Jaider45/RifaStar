import { Global, Module } from '@nestjs/common';
import { env } from '../config/env';
import { MessagesService } from './messages.service';
import { FakeMessagingProvider, MessagingProvider, MetaWhatsAppProvider } from './messaging.provider';
import { NotificationsService } from './notifications.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

@Global()
@Module({
  controllers: [WhatsappWebhookController],
  providers: [
    { provide: MessagingProvider, useClass: env().MESSAGING_DRIVER === 'meta' ? MetaWhatsAppProvider : FakeMessagingProvider },
    MessagesService,
    NotificationsService,
  ],
  exports: [MessagingProvider, MessagesService, NotificationsService],
})
export class MessagingModule {}
