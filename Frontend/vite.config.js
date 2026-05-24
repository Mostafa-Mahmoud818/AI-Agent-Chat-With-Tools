import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolveDevProxyTarget } from './src/config/apiOrigin.js'

/** Dev proxy: `/api/*` and `/v1/internal/*` → modulith origin (see `resolveDevProxyTarget`). Works for DEV, TEST, and LOCAL presets when `VITE_API_RELATIVE=1`. */

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
        '/v1/internal': {
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
