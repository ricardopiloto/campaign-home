import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Em dev, /api e /uploads vão para o servidor Node (npm run dev:server).
const apiTarget = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': apiTarget,
      '/uploads': apiTarget,
    },
  },
})
