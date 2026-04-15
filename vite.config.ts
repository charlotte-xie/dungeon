import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const apiKey = env.XAI_API_KEY
  const baseUrl = env.XAI_BASE_URL || 'https://api.x.ai/v1'

  if (!apiKey) {
    console.warn(
      '[dungeon] XAI_API_KEY not set. Copy .env.local.example to .env.local and add your key.',
    )
  }

  return {
    plugins: [react()],
    server: {
      port: 3000,
      proxy: {
        '/api/xai': {
          target: baseUrl,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/xai/, ''),
          configure: (proxy) => {
            proxy.on('proxyReq', (proxyReq) => {
              if (apiKey) proxyReq.setHeader('Authorization', `Bearer ${apiKey}`)
            })
          },
        },
      },
    },
    preview: { port: 3000 },
    define: {
      __XAI_MODEL__: JSON.stringify(env.XAI_MODEL || 'grok-4'),
    },
  }
})
