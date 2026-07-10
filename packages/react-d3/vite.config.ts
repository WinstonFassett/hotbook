import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import dts from 'vite-plugin-dts'
import { resolve } from 'path'

export default defineConfig({
  plugins: [
    react(),
    dts({ include: ['src'], rollupTypes: true }),
  ],
  build: {
    lib: {
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'HotbookReactD3',
      fileName: 'react-d3',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', '@hotbook/d3', '@hotbook/bireactive'],
      output: {
        globals: { react: 'React' },
      },
    },
  },
})
