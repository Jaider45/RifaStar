import { type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, type OpenAPIObject, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { env } from './config/env';

export const API_PREFIX = 'v1';

/** Crea la app configurada (sin escuchar). La usan main.ts y los tests. */
export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '200kb' });
  app.enableCors({
    origin: env().CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    exposedHeaders: ['X-Request-Id', 'X-Support-Active', 'X-Support-Session', 'Retry-After', 'ETag'],
  });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  return app;
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Rifa Star API')
    .setDescription('API de Rifa Star: sorteos, pagos, ganadores, ranking y plataforma. Errores: { code, message, details }.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addServer('/')
    .build();
  return cleanupOpenApiDoc(SwaggerModule.createDocument(app, config));
}
