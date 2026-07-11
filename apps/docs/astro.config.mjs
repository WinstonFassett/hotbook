// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'url';

// https://astro.build/config
export default defineConfig({
  vite: {
    resolve: {
      // 'node' condition resolves workspace packages (hotbook-charts) to SOURCE
      // (same mechanism as sliceboard) — live HMR, never a stale dist.
      conditions: ['browser', 'node'],
      // One bireactive instance across all modules — two copies silently kill
      // cross-element reactivity.
      dedupe: ['bireactive'],
      alias: {
        bireactive: fileURLToPath(new URL('../../node_modules/bireactive/dist/index.js', import.meta.url)),
      },
    },
  },
});
