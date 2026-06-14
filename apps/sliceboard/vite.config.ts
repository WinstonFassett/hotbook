import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webdev } from '@winstonfassett/webdev-vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), webdev()],
  resolve: {
    alias: {
      '@br-lc': path.resolve(__dirname, '../../apps/vanilla-bireactive-layercharts-spike/src'),
    },
  },
})
