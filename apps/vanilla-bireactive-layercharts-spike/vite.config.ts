import { defineConfig } from "vite";

export default defineConfig({
  // Netlify publishes apps/sliceboard/dist as the site root; this spike app is
  // copied into apps/sliceboard/dist/layercharts so previews can reach it at
  // <preview>/layercharts/. Override via env for dev/other deploys.
  base: process.env.LAYERCHARTS_BASE ?? '/',
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
