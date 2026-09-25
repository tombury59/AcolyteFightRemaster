import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import * as path from 'path';

export default defineConfig({
  plugins: [react()],
  // Some legacy CommonJS deps (e.g. promise-defer) reference Node's `global`.
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      // The project ships its own hand-written planck-js typings; the runtime
      // package is resolved normally, this alias only helps the editor/tsc.
      'planck-js': path.resolve(__dirname, 'node_modules/planck-js'),
    },
  },
  // .glsl files are imported with the `?raw` suffix (see src/client/graphics/*).
  assetsInclude: ['**/*.glsl'],
  server: {
    port: 8080,
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 4000,
  },
});
