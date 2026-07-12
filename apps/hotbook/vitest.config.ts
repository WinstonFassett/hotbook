import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'jsdom',
  },
  resolve: {
    alias: {
      '@hotbook/core': path.resolve(__dirname, '../../packages/core/src'),
      '@hotbook/bireactive': path.resolve(__dirname, '../../packages/bireactive/src'),
      '@hotbook/d3': path.resolve(__dirname, '../../packages/d3/src'),
      '@hotbook/layout': path.resolve(__dirname, '../../packages/layout/src'),
      '@hotbook/apitable': path.resolve(__dirname, '../../packages/apitable/src'),
    },
  },
})
