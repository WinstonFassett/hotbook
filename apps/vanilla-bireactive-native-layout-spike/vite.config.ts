import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Alias `@bireactive` and `@bireactive/*` to the published npm package's
// dist. The npm tarball ships /constraints and /propagators builds but
// does not list them in package.json `exports`, so bare subpath imports
// like `bireactive/constraints` fail Node resolution. This alias points
// directly at the dist files so the spike can import them without
// vendoring the source.
const bireactiveDist = fileURLToPath(
  new URL("../../node_modules/bireactive/dist", import.meta.url),
);

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
  resolve: {
    alias: {
      "@bireactive": bireactiveDist,
    },
  },
  server: { host: true },
});
