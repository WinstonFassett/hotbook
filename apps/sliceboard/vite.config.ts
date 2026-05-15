import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { webdev } from '@winstonfassett/webdev-vite'

export default defineConfig({
  plugins: [react(), webdev()],
})
