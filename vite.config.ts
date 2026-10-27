import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  // En desarrollo la API corre en :3000; el proxy evita CORS y mantiene las cookies en el mismo origen.
  server: {
    proxy: { '/v1': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: true } },
    // Demos por túnel de Cloudflare (https://xxxx.trycloudflare.com). `vite preview` hereda esto y el proxy.
    allowedHosts: ['.trycloudflare.com'],
  },
});
