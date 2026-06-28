import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true },
  resolve: {
    // Resolve @winstonfassett/vizform-charts to its TS source (the `node` export
    // condition → ./src/index.ts) for no-build live dev with HMR. Same pattern
    // as sliceboard. `browser` must stay in the set so other packages that use
    // browser/default conditions resolve correctly.
    conditions: ['browser', 'node'],
    dedupe: ['bireactive'],
  },
});
