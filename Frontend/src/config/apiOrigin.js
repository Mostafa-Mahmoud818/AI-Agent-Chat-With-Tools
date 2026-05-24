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
 * Resolves the active backend preset key (`remote-dev`, `remote-test`, `local`).
 * Same precedence for SPA origin and Vite dev proxy target.
 *
 * @param {Record<string, string | boolean | undefined>} env
 * @returns {string} preset key
 */
export function resolveActiveBackendPreset(env) {
    const runtimePreset = getRuntimeBackendPreset()
    if (runtimePreset && API_BACKENDS[runtimePreset]) {
        return runtimePreset
    }

    const explicit = typeof env.VITE_API_ORIGIN === 'string' ? env.VITE_API_ORIGIN.trim() : ''
    if (explicit) {
        if (/dev-modulith/i.test(explicit)) return 'remote-dev'
        if (/test-modulith/i.test(explicit)) return 'remote-test'
        if (/localhost|127\.0\.0\.1/i.test(explicit)) return 'local'
        return DEFAULT_PRESET
    }

    const key = typeof env.VITE_API_BACKEND === 'string' ? env.VITE_API_BACKEND.trim().toLowerCase() : DEFAULT_PRESET
    return API_BACKENDS[key] ? key : DEFAULT_PRESET
}

/**
 * Resolves the modulith base URL for the browser bundle (fetch/SSE).
 * Priority:
 * 1. UI runtime override (env picker, persisted in localStorage) — always absolute URL
 * 2. {@code VITE_API_RELATIVE=1|true} → empty string when no runtime picker (Vite dev proxy)
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

    const preset = resolveActiveBackendPreset(env)
    return API_BACKENDS[preset].replace(/\/$/, '')
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

    const preset = resolveActiveBackendPreset(env)
    if (preset === 'remote-dev') return 'DEV'
    if (preset === 'remote-test') return 'TEST'
    if (preset === 'local') return 'LOCAL'
    return 'DEV'
}

/**
 * Absolute modulith origin for the Vite dev server proxy (never empty).
 * Uses the same preset resolution as {@link resolveApiOrigin} (including runtime env picker).
 *
 * @param {Record<string, string | boolean | undefined>} env
 * @returns {string}
 */
export function resolveDevProxyTarget(env) {
    const explicit = typeof env.VITE_API_ORIGIN === 'string' ? env.VITE_API_ORIGIN.trim() : ''
    if (explicit) return explicit.replace(/\/$/, '')

    const preset = resolveActiveBackendPreset(env)
    return API_BACKENDS[preset].replace(/\/$/, '')
}

/**
 * True when the SPA uses same-origin relative URLs (Vite dev proxy).
 *
 * @param {Record<string, string | boolean | undefined>} env
 * @returns {boolean}
 */
export function isRelativeApiMode(env) {
    return env.VITE_API_RELATIVE === 'true' || env.VITE_API_RELATIVE === '1'
}

/**
 * Base URL prefix for modulith HTTP calls (OTP, identity, visitor-management).
 * Empty string when {@link isRelativeApiMode} (Vite dev proxy); otherwise absolute preset origin.
 *
 * @param {Record<string, string | boolean | undefined>} env
 * @returns {string}
 */
export function resolveModulithRequestBase(env) {
    return resolveApiOrigin(env)
}
