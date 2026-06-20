import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { webdev } from '@winstonfassett/webdev-vite'
import path from 'path'

export default defineConfig({
  // The svelte plugin compiles the Svelte-LayerChart spike's *.svelte source
  // (aliased as @svelte-lc below) directly into this React app. The components
  // use <svelte:options customElement> so they register as web components on
  // import — same no-build live-dev model as the @br-lc TS source alias. The
  // `extensions` guard keeps the plugin off .ts/.tsx (React owns those).
  plugins: [
    react(),
    // customElement: true so <svelte:options customElement="…"> actually emits a
    // web component (otherwise the option is ignored, $host() is null at runtime,
    // and onDestroy crashes). Every .svelte we consume here is a custom element.
    svelte({ extensions: ['.svelte'], compilerOptions: { customElement: true } }),
    webdev(),
  ],
  resolve: {
    // Resolve the workspace vizform-*-d3 packages to their TS source (their
    // `node` export condition → ./src/index.ts) instead of built dist, so
    // editing a package's src/ ripples live into this dev server via HMR —
    // no `npm run build` step. Publishable dist is still used by the default
    // import/require conditions (CI, npm). See the packages' exports "node" branch.
    //
    // `browser` MUST stay in this set: an explicit `conditions` array REPLACES
    // Vite's default condition list (which includes `browser`). Without it,
    // svelte's exports (worker/browser/default — no `node` key) fall through to
    // `default` → index-server.js (the SSR build), where onDestroy/$host hit a
    // null ssr_context and the components crash. With `browser` present it wins
    // over `default`, resolving svelte to its client build.
    conditions: ['browser', 'node'],
    // Source-resolved packages must share this app's single React copy, else a
    // second instance loads and hooks crash (useState null).
    dedupe: ['react', 'react-dom'],
    alias: {
      '@br-lc': path.resolve(__dirname, '../../apps/vanilla-bireactive-layercharts-spike/src'),
      '@svelte-lc': path.resolve(__dirname, '../../apps/svelte-layerchart-spike/src'),
    },
  },
})
