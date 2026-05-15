import { getRuntimeBackendPreset } from './runtimeSettings.js'

/**
 * Named backend presets (no trailing slash). Override with `VITE_API_ORIGIN`, or pick a preset via `VITE_API_BACKEND`,
 * or via the in-app env picker (persisted to localStorage — see {@link ./runtimeSettings.js}).
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
 * 1. UI runtime override (env picker, persisted in localStorage)
 * 2. {@code VITE_API_RELATIVE=1|true} → empty string (same-origin; use Vite `/api` proxy in dev)
 * 3. Non-empty {@code VITE_API_ORIGIN}
 * 4. {@code VITE_API_BACKEND} preset ({@code local} | {@code remote-dev} | {@code remote-test})
 *
 * @param {Record<string, string | boolean | undefined>} env `import.meta.env` or `loadEnv()` result
 * @returns {string} origin without trailing slash, or "" for relative API calls
 */
export function resolveApiOrigin(env) {
    const runtimePreset = getRuntimeBackendPreset()
    if (runtimePreset && API_BACKENDS[runtimePreset]) {
        return API_BACKENDS[runtimePreset].replace(/\/$/, '')
    }

    const relative = env.VITE_API_RELATIVE === 'true' || env.VITE_API_RELATIVE === '1'
    if (relative) return ''

    const explicit = typeof env.VITE_API_ORIGIN === 'string' ? env.VITE_API_ORIGIN.trim() : ''
    if (explicit) return explicit.replace(/\/$/, '')

    const key = typeof env.VITE_API_BACKEND === 'string' ? env.VITE_API_BACKEND.trim().toLowerCase() : DEFAULT_PRESET
    const base = API_BACKENDS[key] ?? API_BACKENDS[DEFAULT_PRESET]
    return base.replace(/\/$/, '')
}

/**
 * Short label for the active backend preset, used by the auth dialog UI.
 * Returns one of: `DEV`, `TEST`, `LOCAL`, `PROXY`, `CUSTOM`.
 *
 * @param {Record<string, string | boolean | undefined>} env
 * @returns {string}
 */
export function getBackendEnvLabel(env) {
    const runtimePreset = getRuntimeBackendPreset()
    if (runtimePreset === 'remote-dev') return 'DEV'
    if (runtimePreset === 'remote-test') return 'TEST'
    if (runtimePreset === 'local') return 'LOCAL'

    const relative = env.VITE_API_RELATIVE === 'true' || env.VITE_API_RELATIVE === '1'
    if (relative) return 'PROXY'

    const explicit = typeof env.VITE_API_ORIGIN === 'string' ? env.VITE_API_ORIGIN.trim() : ''
    if (explicit) {
        if (/dev-modulith/i.test(explicit)) return 'DEV'
        if (/test-modulith/i.test(explicit)) return 'TEST'
        if (/localhost|127\.0\.0\.1/i.test(explicit)) return 'LOCAL'
        return 'CUSTOM'
    }

    const key = typeof env.VITE_API_BACKEND === 'string'
        ? env.VITE_API_BACKEND.trim().toLowerCase()
        : DEFAULT_PRESET
    if (key === 'remote-dev') return 'DEV'
    if (key === 'remote-test') return 'TEST'
    if (key === 'local') return 'LOCAL'
    return 'DEV'
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
