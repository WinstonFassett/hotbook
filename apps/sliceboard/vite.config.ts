import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webdev } from '@winstonfassett/webdev-vite'
import path from 'path'

export default defineConfig({
  plugins: [react(), webdev()],
  resolve: {
    // Resolve the workspace vizform-*-d3 packages to their TS source (their
    // `node` export condition → ./src/index.ts) instead of built dist, so
    // editing a package's src/ ripples live into this dev server via HMR —
    // no `npm run build` step. Publishable dist is still used by the default
    // import/require conditions (CI, npm). See the packages' exports "node" branch.
    conditions: ['node'],
    // Source-resolved packages must share this app's single React copy, else a
    // second instance loads and hooks crash (useState null).
    dedupe: ['react', 'react-dom'],
    alias: {
      '@br-lc': path.resolve(__dirname, '../../apps/vanilla-bireactive-layercharts-spike/src'),
    },
  },
})
