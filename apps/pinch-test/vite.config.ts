import { defineConfig } from "vite";

export default defineConfig({
  server: { host: true, port: 5199 },
  build: {
    minify: 'terser',
    terser: { keep_classnames: true },
  },
});
