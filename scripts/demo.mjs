#!/usr/bin/env node
/**
 * Demo por internet: «npm run demo».
 *
 *  1. Levanta el entorno de Docker con los túneles de Cloudflare (perfil «demo»).
 *  2. Lee las URLs https://xxxx.trycloudflare.com de los túneles (cambian al reiniciarlos).
 *  3. Las pone en api/docker-compose.override.yml (PUBLIC_BASE_URL, CORS_ORIGINS,
 *     S3_PUBLIC_ENDPOINT) y reinicia la API y el worker si cambiaron.
 *  4. Compila el frontend y lo sirve en :4173 (vite preview, en segundo plano).
 *
 * Se puede correr cuantas veces se quiera: tras reiniciar el equipo basta con volver a correrlo.
 * Para apagar el demo: «npm run demo -- --stop».
 */
import { execFileSync, execSync, spawn } from 'node:child_process';
import { existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const api = join(root, 'api');
const override = join(api, 'docker-compose.override.yml');
const pidFile = join(root, '.demo-preview.pid');
const logFile = join(root, '.demo-preview.log');
const PREVIEW_PORT = 4173;

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: api, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
const compose = (...args) => run('docker', ['compose', '--profile', 'demo', ...args]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`· ${msg}`);

function stopPreview() {
  if (!existsSync(pidFile)) return;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  try {
    process.kill(pid);
    log(`Web anterior detenida (pid ${pid}).`);
  } catch {
    /* ya no estaba corriendo */
  }
  rmSync(pidFile, { force: true });
}

if (process.argv.includes('--stop')) {
  stopPreview();
  compose('stop', 'tunnel-web', 'tunnel-s3');
  log('Túneles detenidos. El entorno local sigue arriba.');
  process.exit(0);
}

/** Última URL de un túnel (los logs se acumulan entre reinicios). */
async function tunnelUrl(service) {
  for (let i = 0; i < 60; i++) {
    const urls = compose('logs', '--no-color', service).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    if (urls?.length) return urls.at(-1);
    await sleep(2000);
  }
  throw new Error(`El túnel ${service} no entregó una URL en 2 minutos. Revisa «docker compose logs ${service}».`);
}

if (!existsSync(override)) {
  writeFileSync(
    override,
    '# Ajustes locales de esta máquina (no van a git). Compose lo carga junto a docker-compose.yml.\n' +
      'x-demo-env: &demo-env\n  PUBLIC_BASE_URL: http://localhost:5173\n  CORS_ORIGINS: http://localhost:5173\n  S3_PUBLIC_ENDPOINT: http://localhost:9000\n\n' +
      'services:\n  api:\n    environment: *demo-env\n  worker:\n    environment: *demo-env\n',
  );
  log('Creé api/docker-compose.override.yml.');
}

log('Levantando Docker (base de datos, API, worker, almacenamiento y túneles)…');
compose('up', '-d');
const web = await tunnelUrl('tunnel-web');
const s3 = await tunnelUrl('tunnel-s3');

let text = readFileSync(override, 'utf8');
const before = text;
const setVar = (name, value) => {
  const re = new RegExp(`^(\\s*${name}:).*$`, 'm');
  if (!re.test(text)) throw new Error(`Falta ${name} en api/docker-compose.override.yml (bloque x-demo-env).`);
  text = text.replace(re, `$1 ${value}`);
};
setVar('PUBLIC_BASE_URL', web);
setVar('CORS_ORIGINS', `${web},http://localhost:5173`);
setVar('S3_PUBLIC_ENDPOINT', s3);
if (text !== before) {
  writeFileSync(override, text);
  log('URLs nuevas de los túneles: reiniciando la API y el worker…');
  compose('up', '-d', 'api', 'worker');
}

log('Compilando el frontend…');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

stopPreview();
const apiPort = readFileSync(override, 'utf8').match(/"(\d+):3000"/)?.[1] ?? '3000';
const out = openSync(logFile, 'w');
const child = spawn(process.execPath, [join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--port', String(PREVIEW_PORT), '--strictPort', '--host', '0.0.0.0'], {
  cwd: root,
  env: { ...process.env, VITE_API_PROXY: `http://localhost:${apiPort}` },
  detached: true,
  stdio: ['ignore', out, out],
  windowsHide: true,
});
child.unref();
writeFileSync(pidFile, String(child.pid));

for (let i = 0; i < 30; i++) {
  const ok = await fetch(`${web}/`).then((r) => r.ok).catch(() => false);
  if (ok) break;
  await sleep(2000);
}
console.log(`\nDemo lista: ${web}\n  Panel: ${web}/login · Plataforma: ${web}/plataforma/login\n  (Registro de la web: .demo-preview.log · Apagar: npm run demo -- --stop)`);
