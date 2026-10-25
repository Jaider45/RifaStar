import type { Params } from 'nestjs-pino';
import { env } from './config/env';

/**
 * Logs estructurados sin datos personales: se ocultan cabeceras sensibles y
 * nunca se registran cuerpos de solicitud (teléfonos, nombres, comprobantes).
 */
export function loggerParams(): Params {
  return {
    pinoHttp: {
      level: env().NODE_ENV === 'test' ? 'silent' : env().LOG_LEVEL,
      genReqId: (req) => (req as unknown as { requestId?: string }).requestId ?? '',
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie', 'req.headers["x-order-token"]', 'res.headers["set-cookie"]'],
        censor: '[oculto]',
      },
      serializers: {
        req: (req: { id: string; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          // La query puede traer teléfonos o tokens.
          url: req.url.split('?')[0],
        }),
      },
      transport: env().NODE_ENV === 'development' ? { target: 'pino-pretty', options: { singleLine: true } } : undefined,
    },
  };
}
