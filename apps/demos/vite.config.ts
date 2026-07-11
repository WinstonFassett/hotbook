import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true },
  resolve: {
    // Resolve @hotbook/bireactive to its TS source (the `node` export
    // condition → ./src/index.ts) for no-build live dev with HMR. Same pattern
    // as hotbook. `browser` must stay in the set so other packages that use
    // browser/default conditions resolve correctly.
    conditions: ['browser', 'node'],
    dedupe: ['bireactive'],
  },
  build: {
    // The per-demo "source" panel prints scene.toString() at runtime, so the
    // built bundle must keep readable multi-line method bodies. Class names
    // must also survive: Diagram subclasses derive their custom element tag
    // name from the class name via static get tagName().
    minify: false,
  },
});
