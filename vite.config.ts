import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command, mode }) => {
  // The dev server alone hands the app an xAI key, from XAI_API_KEY in
  // .env.local or the environment, for a browser without one of its own.
  // Tests and builds get an empty key, so it never reaches a bundle.
  const devXaiKey =
    command === 'serve' && mode === 'development' ? (loadEnv(mode, process.cwd(), '').XAI_API_KEY ?? '') : ''
  return {
    base: command === 'build' ? '/dungeon/' : '/',
    plugins: [react()],
    define: { __DEV_XAI_KEY__: JSON.stringify(devXaiKey) },
    server: { port: 3003 },
    preview: { port: 3003 },
  }
})
