import { defineConfig } from "vite";

export default defineConfig({
  build: {
    // bireactive's Diagram.define() derives the custom element tag name from
    // the class name at runtime (this.name). Rollup's default minifier mangles
    // class names to short ids (e.g. "f0"), making define() throw
    // "not a valid custom element name". Keep class names intact.
    minify: 'terser',
    terserOptions: {
      keep_classnames: true,
    },
  },
  server: { host: true },
});
