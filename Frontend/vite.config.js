import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveDevProxyTarget } from './src/config/apiOrigin.js'

/** Dev proxy: `/api/*` → absolute modulith origin (see `resolveDevProxyTarget`). Pair with `VITE_API_RELATIVE=1` so the SPA calls same-origin `/api/...`. */

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = resolveDevProxyTarget(env)

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
      },
    },
    test: {
      globals: true,
      environment: 'jsdom',
      setupFiles: './src/test/setup.js',
      css: true,
    },
  }
})
