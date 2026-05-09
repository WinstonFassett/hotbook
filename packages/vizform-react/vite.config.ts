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
      name: 'VizformReact',
      fileName: 'vizform-react',
    },
    rollupOptions: {
      external: ['react', 'react/jsx-runtime', '@winstonfassett/vizform-core'],
      output: {
        globals: { react: 'React' },
      },
    },
  },
})
