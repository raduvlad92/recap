import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import netlify from '@netlify/vite-plugin';
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'test' ? [] : [netlify({ edgeFunctions: { enabled: false }, database: { enabled: false }, blobs: { enabled: false }, images: { enabled: false }, geolocation: { enabled: false } })])],
  server: { port: 5173 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
