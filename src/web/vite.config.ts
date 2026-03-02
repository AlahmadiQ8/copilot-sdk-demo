import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: './dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/chat': 'http://localhost:3000',
      '/summarize': 'http://localhost:3000',
      '/config': 'http://localhost:3000',
      '/health': 'http://localhost:3000',
    },
  },
})
