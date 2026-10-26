/**
 * Exporta la colección OpenAPI a api/openapi.json (npm run openapi).
 * Se puede importar en Postman, Insomnia o Bruno.
 */
import './config/load-env';
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildOpenApi, createApp } from './app.factory';

async function main() {
  const app = await createApp();
  await app.init();
  const doc = buildOpenApi(app);
  const out = join(process.cwd(), 'openapi.json');
  writeFileSync(out, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`OpenAPI: ${Object.keys(doc.paths).length} rutas → ${out}`);
  await app.close();
  process.exit(0);
}

void main();
