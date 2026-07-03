import { defineConfig, type PluginOption } from 'vite'
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
  plugins: [
    sveltePlugin?.({ extensions: ['.svelte'], compilerOptions: { customElement: true } }),
    webdevPlugin?.(),
  ],
  resolve: {
    conditions: ['browser', 'node'],
    dedupe: ['bireactive'],
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
