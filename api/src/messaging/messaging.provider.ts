import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

export interface TemplateMessage {
  /** E.164 */
  to: string;
  /** Nombre de la plantilla aprobada en Meta. */
  template: string;
  language: string;
  /** Parámetros del cuerpo, en orden ({{1}}, {{2}}, …). */
  bodyParams: string[];
  /** Texto equivalente (para registros y el proveedor de pruebas). */
  preview: string;
}

/** Error del proveedor: `permanent` = no tiene sentido reintentar (número inválido, plantilla rechazada…). */
export class MessagingError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

/** Proveedor de mensajería intercambiable (WhatsApp Cloud API, fake…). */
export abstract class MessagingProvider {
  abstract sendTemplate(message: TemplateMessage): Promise<{ providerMessageId: string }>;
}

/** WhatsApp Cloud API de Meta. */
@Injectable()
export class MetaWhatsAppProvider extends MessagingProvider {
  async sendTemplate(m: TemplateMessage): Promise<{ providerMessageId: string }> {
    const e = env();
    const url = `https://graph.facebook.com/${e.WHATSAPP_API_VERSION}/${e.WHATSAPP_PHONE_NUMBER_ID}/messages`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${e.WHATSAPP_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: m.to.replace(/^\+/, ''),
          type: 'template',
          template: {
            name: m.template,
            language: { code: m.language },
            components: m.bodyParams.length
              ? [{ type: 'body', parameters: m.bodyParams.map((text) => ({ type: 'text', text })) }]
              : [],
          },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      throw new MessagingError(`Sin respuesta de WhatsApp: ${(err as Error).message}`, false);
    }
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message?: string; code?: number } };
    if (!res.ok) {
      // 429 y 5xx se reintentan; el resto de 4xx son definitivos.
      const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
      throw new MessagingError(`WhatsApp ${res.status}: ${body.error?.message ?? 'error'}`, permanent);
    }
    const id = body.messages?.[0]?.id;
    if (!id) throw new MessagingError('WhatsApp no devolvió el id del mensaje.', false);
    return { providerMessageId: id };
  }
}

/** Desarrollo y tests: no envía nada; guarda los mensajes y puede simular fallas. */
@Injectable()
export class FakeMessagingProvider extends MessagingProvider {
  private readonly logger = new Logger('FakeWhatsApp');
  readonly sent: (TemplateMessage & { providerMessageId: string })[] = [];
  private failures: { permanent: boolean }[] = [];
  private seq = 0;

  async sendTemplate(m: TemplateMessage): Promise<{ providerMessageId: string }> {
    const failure = this.failures.shift();
    if (failure) throw new MessagingError('Falla simulada', failure.permanent);
    const providerMessageId = `wamid.fake.${Date.now()}.${++this.seq}`;
    this.sent.push({ ...m, providerMessageId });
    this.logger.debug(`WhatsApp simulado a ***${m.to.slice(-4)}: ${m.template}`);
    return { providerMessageId };
  }

  failNext(times: number, permanent = false): void {
    this.failures.push(...Array.from({ length: times }, () => ({ permanent })));
  }

  to(phone: string) {
    return this.sent.filter((m) => m.to === phone);
  }

  reset(): void {
    this.sent.length = 0;
    this.failures = [];
  }
}
