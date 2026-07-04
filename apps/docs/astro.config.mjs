// @ts-check
import { defineConfig } from 'astro/config';
import { fileURLToPath } from 'url';

// https://astro.build/config
export default defineConfig({
  vite: {
    resolve: {
      alias: {
        // Force a single bireactive instance across all modules
        // (vizform-charts dist imports "bireactive", our TS imports "bireactive" —
        // without this, Vite resolves them to different URLs = two instances)
        bireactive: fileURLToPath(new URL('../../node_modules/bireactive/dist/index.js', import.meta.url)),
      },
    },
  },
});
