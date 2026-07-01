import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

let sveltePlugin: ((opts: unknown) => PluginOption) | null = null
try {
  sveltePlugin = (await import('@sveltejs/vite-plugin-svelte')).svelte as (opts: unknown) => PluginOption
} catch { /* svelte not available in this env */ }

let webdevPlugin: (() => PluginOption) | null = null
try {
  webdevPlugin = (await import('@winstonfassett/webdev-vite')).webdev as () => PluginOption
} catch { /* not available in all envs (CI/prod) */ }

export default defineConfig({
  // The svelte plugin compiles the Svelte-LayerChart spike's *.svelte source
  // (aliased as @svelte-lc below) directly into this React app. The components
  // use <svelte:options customElement> so they register as web components on
  // import — same no-build live-dev model as the @winstonfassett/vizform-charts package.
  // The `extensions` guard keeps the plugin off .ts/.tsx (React owns those).
  plugins: [
    react(),
    // customElement: true so <svelte:options customElement="…"> actually emits a
    // web component (otherwise the option is ignored, $host() is null at runtime,
    // and onDestroy crashes). Every .svelte we consume here is a custom element.
    sveltePlugin?.({ extensions: ['.svelte'], compilerOptions: { customElement: true } }),
    webdevPlugin?.(),
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
    // second instance loads and hooks crash (useState null). bireactive is deduped
    // so the package-resolved source and sliceboard share ONE runtime instance.
    dedupe: ['react', 'react-dom', 'bireactive'],
    alias: {
      '@svelte-lc': path.resolve(__dirname, '../../apps/svelte-layerchart-spike/src'),
    },
  },
  build: {
    // bireactive's Diagram subclasses derive their custom element tag name from
    // the class name at runtime via static get tagName(). Rollup minifies class
    // names to single letters (e.g. "f0"), making define() throw. Keep them.
    minify: 'terser',
    terserOptions: {
      keep_classnames: true,
    },
  },
})
