import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // Capacitor 與後端靜態檔都用相對路徑
  server: { port: 5173, host: true },
  build: { outDir: 'dist', target: 'es2020', chunkSizeWarningLimit: 1600 },
})
