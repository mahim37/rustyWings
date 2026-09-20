import { statSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/** Size of the wasm binary at build time, shown in the status bar. */
function wasmBytes(): number {
  try {
    return statSync(new URL('./src/wasm/rustywings_wasm_bg.wasm', import.meta.url)).size;
  } catch {
    return 0;
  }
}

const sha = process.env['VERCEL_GIT_COMMIT_SHA'] ?? process.env['GITHUB_SHA'] ?? '';

export default defineConfig({
  define: {
    __WASM_BYTES__: JSON.stringify(wasmBytes()),
    __BUILD_SHA__: JSON.stringify(sha.slice(0, 7) || 'dev'),
  },
  // The simulation worker is an ES module so the wasm-bindgen glue can locate
  // its .wasm with `new URL(..., import.meta.url)`.
  worker: { format: 'es' },
  build: { target: 'es2022', sourcemap: true },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
