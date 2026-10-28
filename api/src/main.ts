import './config/load-env';
import 'reflect-metadata';
import { SwaggerModule } from '@nestjs/swagger';
import { API_PREFIX, buildOpenApi, createApp } from './app.factory';
import { env } from './config/env';

async function bootstrap() {
  const app = await createApp();
  // La documentación interactiva solo en desarrollo: en producción no se expone el mapa de la API.
  if (env().NODE_ENV !== 'production') {
    SwaggerModule.setup(`${API_PREFIX}/docs`, app, buildOpenApi(app), { jsonDocumentUrl: `${API_PREFIX}/openapi.json` });
  }
  await app.listen(env().PORT);
}

void bootstrap();
