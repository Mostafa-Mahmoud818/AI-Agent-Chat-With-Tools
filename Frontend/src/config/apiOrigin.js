/**
 * Named backend presets (no trailing slash). Override with `VITE_API_ORIGIN`, or pick a preset via `VITE_API_BACKEND`.
 * @see resolveApiOrigin
 */
export const API_BACKENDS = {
    'remote-dev': 'https://dev-modulith.naitive.ai',
    'remote-test': 'https://test-modulith.naitive.ai',
    local: 'http://localhost:8085',
}

const DEFAULT_PRESET = 'remote-dev'

/**
 * Resolves the modulith base URL for the browser bundle (fetch/SSE).
 * Priority:
 * 1. {@code VITE_API_RELATIVE=1|true} → empty string (same-origin; use Vite `/api` proxy in dev)
 * 2. Non-empty {@code VITE_API_ORIGIN}
 * 3. {@code VITE_API_BACKEND} preset ({@code local} | {@code remote-dev} | {@code remote-test})
 *
 * @param {Record<string, string | boolean | undefined>} env `import.meta.env` or `loadEnv()` result
 * @returns {string} origin without trailing slash, or "" for relative API calls
 */
export function resolveApiOrigin(env) {
    const relative = env.VITE_API_RELATIVE === 'true' || env.VITE_API_RELATIVE === '1'
    if (relative) return ''

    const explicit = typeof env.VITE_API_ORIGIN === 'string' ? env.VITE_API_ORIGIN.trim() : ''
    if (explicit) return explicit.replace(/\/$/, '')

    const key = typeof env.VITE_API_BACKEND === 'string' ? env.VITE_API_BACKEND.trim().toLowerCase() : DEFAULT_PRESET
    const base = API_BACKENDS[key] ?? API_BACKENDS[DEFAULT_PRESET]
    return base.replace(/\/$/, '')
}

/**
 * Absolute modulith origin for the Vite dev server `/api` proxy (never empty).
 * When {@code VITE_API_RELATIVE=1}, the SPA uses relative URLs but the proxy still forwards to a real host.
 *
 * @param {Record<string, string | boolean | undefined>} env
 * @returns {string}
 */
export function resolveDevProxyTarget(env) {
    const explicit = typeof env.VITE_API_ORIGIN === 'string' ? env.VITE_API_ORIGIN.trim() : ''
    if (explicit) return explicit.replace(/\/$/, '')

    const key = typeof env.VITE_API_BACKEND === 'string' ? env.VITE_API_BACKEND.trim().toLowerCase() : DEFAULT_PRESET
    const base = API_BACKENDS[key] ?? API_BACKENDS[DEFAULT_PRESET]
    return base.replace(/\/$/, '')
}
