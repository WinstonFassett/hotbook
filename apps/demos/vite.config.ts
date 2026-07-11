import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  server: { host: true },
  resolve: {
    // Resolve @hotbook/bireactive to its TS source (the `node` export
    // condition → ./src/index.ts) for no-build live dev with HMR. Same pattern
    // as sliceboard. `browser` must stay in the set so other packages that use
    // browser/default conditions resolve correctly.
    conditions: ['browser', 'node'],
    dedupe: ['bireactive'],
  },
  build: {
    // bireactive's Diagram subclasses derive their custom element tag name from
    // the class name at runtime via static get tagName(). Rollup minifies class
    // names to single letters (e.g. "f0"), making define() throw. Keep them.
    minify: 'terser',
    terserOptions: {
      keep_classnames: true,
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        layout: resolve(__dirname, 'src/layout/index.html'),
      },
    },
  },
});
