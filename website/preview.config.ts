import { defineConfig } from 'vite';
import { basePath } from './flyleaf-settings.mjs';

// Serve only the exported files; preview must not load the framework's SSR
// server. It serves them under the same address as the build (basePath).
export default defineConfig({
  base: basePath(),
  build: { outDir: 'dist/client' },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
});
