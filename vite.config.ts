import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/dungeon/' : '/',
  plugins: [react()],
  server: { port: 3003 },
  preview: { port: 3003 },
}))
