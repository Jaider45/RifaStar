import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';

/**
 * Destino del proxy de /v1: VITE_API_PROXY o, si no, el puerto que publica la API de Docker.
 * En equipos donde el 3000 está ocupado, api/docker-compose.override.yml la saca por otro
 * (por ejemplo "3100:3000"); sin leerlo, la web le hablaría a lo que esté en el 3000.
 */
function apiTarget(): string {
  if (process.env.VITE_API_PROXY) return process.env.VITE_API_PROXY;
  const override = fileURLToPath(new URL('./api/docker-compose.override.yml', import.meta.url));
  const port = existsSync(override) ? readFileSync(override, 'utf8').match(/"(\d+):3000"/)?.[1] : undefined;
  return `http://localhost:${port ?? '3000'}`;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // El proxy evita CORS y mantiene las cookies en el mismo origen.
  server: {
    proxy: { '/v1': { target: apiTarget(), changeOrigin: true } },
    // Demos por túnel de Cloudflare (https://xxxx.trycloudflare.com). `vite preview` hereda esto y el proxy.
    allowedHosts: ['.trycloudflare.com'],
  },
});
