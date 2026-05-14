/**
 * @file Runtime bearer token store (env bootstrap + session persistence).
 * @module auth/tokenStore
 */

const STORAGE_KEY = 'ankabut.chat.accessToken'

let runtimeToken = ''

/**
 * Initializes runtime token from env and persisted storage.
 * Env token takes precedence over storage.
 *
 * @param {Record<string, unknown>} env
 * @returns {void}
 */
export function initTokenStore(env) {
    const envToken = typeof env?.VITE_API_BEARER_TOKEN === 'string'
        ? env.VITE_API_BEARER_TOKEN.trim()
        : ''
    if (envToken) {
        runtimeToken = envToken
        try {
            localStorage.setItem(STORAGE_KEY, envToken)
        } catch {
            // Ignore browser storage restrictions.
        }
        return
    }

    try {
        const stored = localStorage.getItem(STORAGE_KEY)?.trim() ?? ''
        runtimeToken = stored
    } catch {
        runtimeToken = ''
    }
}

/**
 * Returns current bearer token.
 *
 * @returns {string}
 */
export function getAccessToken() {
    return runtimeToken
}

/**
 * Updates runtime bearer token and persists it.
 *
 * @param {string} token
 * @returns {void}
 */
export function setAccessToken(token) {
    const normalized = typeof token === 'string' ? token.trim() : ''
    runtimeToken = normalized
    try {
        if (normalized) {
            localStorage.setItem(STORAGE_KEY, normalized)
        } else {
            localStorage.removeItem(STORAGE_KEY)
        }
    } catch {
        // Ignore browser storage restrictions.
    }
}
