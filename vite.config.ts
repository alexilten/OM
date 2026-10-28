import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // rhino3dm ships an Emscripten ESM build that locates its .wasm via import.meta.url;
  // pre-bundling would break that lookup.
  optimizeDeps: { exclude: ['rhino3dm'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  test: { environment: 'node', include: ['tests/**/*.test.ts'], testTimeout: 30000 },
});
