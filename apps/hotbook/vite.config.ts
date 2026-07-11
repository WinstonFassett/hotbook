import { defineConfig, type PluginOption } from 'vite'
import path from 'path'

let sveltePlugin: ((opts: unknown) => PluginOption) | null = null
try {
  sveltePlugin = (await import('@sveltejs/vite-plugin-svelte')).svelte as (opts: unknown) => PluginOption
} catch { /* svelte not available in this env */ }

let reactPlugin: (() => PluginOption) | null = null
try {
  reactPlugin = (await import('@vitejs/plugin-react')).default as () => PluginOption
} catch { /* not available in all envs (CI/prod) */ }

let webdevPlugin: (() => PluginOption) | null = null
try {
  webdevPlugin = (await import('@winstonfassett/webdev-vite')).webdev as () => PluginOption
} catch { /* not available in all envs (CI/prod) */ }

export default defineConfig({
  plugins: [
    sveltePlugin?.({ extensions: ['.svelte'], compilerOptions: { customElement: true } }),
    reactPlugin?.(),
    webdevPlugin?.(),
  ],
  resolve: {
    conditions: ['browser', 'node'],
    dedupe: ['bireactive'],
    alias: {
      '@hotbook/core': path.resolve(__dirname, '../../packages/core/src'),
      '@hotbook/bireactive': path.resolve(__dirname, '../../packages/bireactive/src'),
      '@hotbook/d3': path.resolve(__dirname, '../../packages/d3/src'),
      '@hotbook/layout': path.resolve(__dirname, '../../packages/layout/src'),
      '@hotbook/apitable': path.resolve(__dirname, '../../packages/apitable/src'),
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
