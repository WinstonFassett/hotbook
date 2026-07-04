import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true },
  build: {
    // bireactive's Diagram subclasses derive their custom element tag name from
    // the class name at runtime via static get tagName(). Rollup minifies class
    // names to single letters (e.g. "f0"), making define() throw. Keep them.
    minify: 'terser',
    terserOptions: {
      keep_classnames: true,
    },
  },
});
