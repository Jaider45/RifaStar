import 'reflect-metadata';
import { SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX, buildOpenApi, createApp } from './app.factory';
import { env, loadDotEnv } from './config/env';

async function bootstrap() {
  loadDotEnv();
  const app = await createApp();
  SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApi(app), { jsonDocumentUrl: `${API_PREFIX}/openapi.json` });
  await app.listen(env().PORT);
}

void bootstrap();
