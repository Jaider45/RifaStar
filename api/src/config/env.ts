import { existsSync } from 'node:fs';
import { z } from 'zod';

const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes'].includes(v.toLowerCase())));

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  PUBLIC_BASE_URL: z.string().url().default('http://localhost:5173'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_DATABASE_URL: z.string().min(1),
  SYSTEM_DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_PARTICIPANT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'ENCRYPTION_KEY debe ser 32 bytes en base64'),
  HASH_PEPPER: z.string().min(8),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  COOKIE_SECURE: bool.default(true),

  STORAGE_DRIVER: z.enum(['s3', 'fake']).default('s3'),
  S3_ENDPOINT: z.string().optional(),
  /** Endpoint con el que el navegador sube y descarga (en Docker difiere del interno). */
  S3_PUBLIC_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('rifastar'),
  S3_ACCESS_KEY: z.string().default(''),
  S3_SECRET_KEY: z.string().default(''),
  S3_FORCE_PATH_STYLE: bool.default(false),

  MAIL_DRIVER: z.enum(['smtp', 'fake']).default('smtp'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Rifa Star <no-responder@rifastar.co>'),

  MESSAGING_DRIVER: z.enum(['meta', 'fake']).default('fake'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().default(''),
  WHATSAPP_ACCESS_TOKEN: z.string().default(''),
  WHATSAPP_APP_SECRET: z.string().default(''),
  WHATSAPP_VERIFY_TOKEN: z.string().default(''),
  WHATSAPP_API_VERSION: z.string().default('v21.0'),
  /** Base del reintento exponencial de send-whatsapp (ms). */
  MESSAGES_RETRY_BASE_MS: z.coerce.number().int().positive().default(30_000),

  /** Resultados de loterías (informativos): LoteríaYa o un proveedor falso para desarrollo y tests. */
  LOTTERY_DRIVER: z.enum(['loteriaya', 'fake']).default('fake'),
  LOTERIAYA_BASE_URL: z.string().url().default('https://www.loteriaya.com.co/v1'),
  LOTERIAYA_API_KEY: z.string().default(''),
  /** Secreto HMAC-SHA256 de los webhooks (lo entrega LoteríaYa al dar de alta la clave). */
  LOTERIAYA_WEBHOOK_SECRET: z.string().default(''),
  /** Cabecera con la firma. Confírmala con la especificación que envía LoteríaYa por correo. */
  LOTERIAYA_SIGNATURE_HEADER: z.string().default('x-loteriaya-signature'),

  BILLING_DRIVER: z.enum(['stripe', 'fake']).default('fake'),
  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

/**
 * Carga `.env` (si existe) sin pisar variables ya definidas. Se llama al inicio de cada
 * proceso; en producción no hay archivo y manda el entorno del contenedor.
 */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Variables de entorno validadas. Falla al arrancar si falta algo. */
export function env(): Env {
  if (!cached) {
    const parsed = EnvSchema.safeParse(process.env);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
      throw new Error(`Configuración inválida:\n${issues}`);
    }
    cached = parsed.data;
  }
  return cached;
}

/** Solo para tests: vuelve a leer process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}
