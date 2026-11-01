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

// Sin tope de buffer el script se caía con ENOBUFS: el registro de un túnel caducado (que reintenta sin
// parar) pasa de 1 MB, que es el límite por defecto de execFileSync.
const MAX_BUFFER = 512 * 1024 * 1024;
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd: api, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: MAX_BUFFER, ...opts });
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

/**
 * URL vigente de un túnel: se la pregunta a cloudflared (http://<servicio>:20241/quicktunnel) desde el
 * contenedor de la API, que está en la misma red. Leerla de los logs no sirve: se acumulan entre
 * reinicios (al volver a encender un túnel detenido, la última URL del log es la vieja) y, cuando
 * pasan de cierto tamaño, Docker devuelve solo una parte.
 */
function currentUrl(service) {
  const script = `fetch('http://${service}:20241/quicktunnel').then((r) => r.json()).then((j) => process.stdout.write(j.hostname || ''))`;
  try {
    const host = compose('exec', '-T', 'api', 'node', '-e', script).trim();
    return host ? `https://${host}` : undefined;
  } catch {
    return undefined; // el túnel o la API todavía están arrancando
  }
}

/** URL de un túnel en cuanto la tenga. Con `stale`, espera una distinta de esa. */
async function tunnelUrl(service, stale) {
  for (let i = 0; i < 60; i++) {
    const url = currentUrl(service);
    if (url && url !== stale) return url;
    await sleep(2000);
  }
  throw new Error(`El túnel ${service} no entregó una URL en 2 minutos. Revisa «docker compose logs --tail 50 ${service}».`);
}

/**
 * Los túneles rápidos de Cloudflare caducan: el contenedor sigue vivo pero reintenta para siempre con
 * «Tunnel not found» y su URL ya no sirve. Si el túnel está así se reinicia para que pida una nueva.
 */
async function liveTunnelUrl(service) {
  if (/Tunnel not found/.test(compose('logs', '--no-color', '--tail', '5', service))) {
    const stale = currentUrl(service);
    log(`El túnel ${service} caducó (Cloudflare ya no lo reconoce): reiniciándolo para obtener una URL nueva…`);
    compose('restart', service);
    return tunnelUrl(service, stale);
  }
  return tunnelUrl(service);
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
const web = await liveTunnelUrl('tunnel-web');
const s3 = await liveTunnelUrl('tunnel-s3');

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

// Un túnel recién creado tarda unos segundos en ser visible desde internet.
let reachable = false;
for (let i = 0; i < 30 && !reachable; i++) {
  reachable = await fetch(`${web}/v1/health`).then((r) => r.ok).catch(() => false);
  if (!reachable) await sleep(2000);
}
if (!reachable) {
  console.error(
    `\nLa web no respondió por el túnel en 1 minuto (${web}).\n` +
      `  · Local: http://localhost:${PREVIEW_PORT} · Registro de la web: .demo-preview.log\n` +
      '  · Túnel: docker compose --profile demo logs --tail 50 tunnel-web (en api/)\n' +
      '  A veces Cloudflare tarda más: prueba la URL en un par de minutos o corre «npm run demo» otra vez.',
  );
  process.exit(1);
}
console.log(`\nDemo lista: ${web}\n  Panel: ${web}/login · Plataforma: ${web}/plataforma/login\n  (Registro de la web: .demo-preview.log · Apagar: npm run demo -- --stop)`);
