import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Alias `@bireactive` and `@bireactive/*` to the vendored source under
// inspo/. The published npm `bireactive@0.2.4` does NOT expose
// /constraints or /propagators subpaths; this spike needs them.
const bireactiveSrc = fileURLToPath(
  new URL("../../inspo/bireactive/src", import.meta.url),
);

export default defineConfig({
  base: '/native-layout/',
  build: {
    outDir: '../../apps/sliceboard/dist/native-layout',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      "@bireactive": bireactiveSrc,
    },
  },
  server: { host: true },
});
