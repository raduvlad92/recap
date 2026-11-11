import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import netlify from '@netlify/vite-plugin';
import { fileURLToPath } from 'node:url';
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'test' ? [] : [netlify({ edgeFunctions: { enabled: false }, database: { enabled: false }, blobs: { enabled: false }, images: { enabled: false }, geolocation: { enabled: false } })])],
  server: { port: 5173 },
  resolve: mode === 'test' ? { alias: { 'cloudflare:workers': fileURLToPath(new URL('./tests/helpers/worker-entrypoint.ts', import.meta.url)) } } : undefined,
  test: { environment: 'node', include: ['tests/**/*.test.{ts,mjs}'] },
}));
