import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import electron from 'vite-plugin-electron/simple'

export default defineConfig({
  base: './',
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.js'
      },
      preload: {
        input: 'electron/preload.js'
      }
    })
  ],
  server: {
    port: 5173,
    host: '127.0.0.1'
  }
})
