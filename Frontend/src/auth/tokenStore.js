/**
 * @file Runtime bearer token store (env bootstrap + session persistence).
 * @module auth/tokenStore
 *
 * Stores the access token plus, for real OTP sign-ins, the paired refresh token and the access
 * token's computed expiry instant. The refresh token is one-time-use (server rotates it on every
 * `/api/v1/public/identity/auth/token/refresh` call — see {@link ../tokenRefresh.js}), so the
 * *new* refresh token returned by that call must always replace the stored one via {@link setTokens}.
 * An env-bootstrapped token ({@code VITE_API_BEARER_TOKEN}) has no companion refresh token or known
 * expiry; {@link getAccessTokenExpiresAt} returns {@code 0} (unknown) for that case, which callers
 * must treat as "never force-refresh".
 */

const STORAGE_KEY = 'ankabut.chat.accessToken'
const REFRESH_STORAGE_KEY = 'ankabut.chat.refreshToken'
const EXPIRES_AT_STORAGE_KEY = 'ankabut.chat.accessTokenExpiresAt'

let runtimeToken = ''
let runtimeRefreshToken = ''
/** Epoch ms the access token expires at; {@code 0} means unknown/not applicable. */
let runtimeExpiresAt = 0

function readStorage(key) {
    try {
        return localStorage.getItem(key)?.trim() ?? ''
    } catch {
        return ''
    }
}

function writeStorage(key, value) {
    try {
        if (value) {
            localStorage.setItem(key, value)
        } else {
            localStorage.removeItem(key)
        }
    } catch {
        // Ignore browser storage restrictions.
    }
}

/**
 * Initializes runtime token from env and persisted storage.
 * Env token takes precedence over storage; an env-bootstrapped token has no refresh companion, so
 * any previously persisted refresh token / expiry (from an earlier real sign-in) is cleared to
 * avoid the refresh flow later trying to pair it with this unrelated token.
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
        runtimeRefreshToken = ''
        runtimeExpiresAt = 0
        writeStorage(STORAGE_KEY, envToken)
        writeStorage(REFRESH_STORAGE_KEY, '')
        writeStorage(EXPIRES_AT_STORAGE_KEY, '')
        return
    }

    runtimeToken = readStorage(STORAGE_KEY)
    runtimeRefreshToken = readStorage(REFRESH_STORAGE_KEY)
    const storedExpiresAt = Number(readStorage(EXPIRES_AT_STORAGE_KEY))
    runtimeExpiresAt = Number.isFinite(storedExpiresAt) ? storedExpiresAt : 0
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
 * Returns the current refresh token, or {@code ''} when none is stored (guest/env-bootstrap/never
 * signed in via OTP).
 *
 * @returns {string}
 */
export function getRefreshToken() {
    return runtimeRefreshToken
}

/**
 * Re-reads the persisted refresh token into the runtime copy and returns it.
 *
 * The auth server runs with {@code reuse-refresh-tokens=false}, so every refresh rotates the token
 * and the previous value becomes unusable immediately. Because `localStorage` is shared across tabs
 * but this module's runtime copy is per-tab, the value loaded at {@link initTokenStore} goes stale
 * the moment any *other* tab refreshes. Call this immediately before spending the token so a tab
 * always sends the current one rather than a sibling's already-rotated value.
 *
 * @returns {string}
 */
export function reloadPersistedRefreshToken() {
    runtimeRefreshToken = readStorage(REFRESH_STORAGE_KEY)
    return runtimeRefreshToken
}

/**
 * Returns the access token's expiry instant (epoch ms), or {@code 0} when unknown.
 *
 * @returns {number}
 */
export function getAccessTokenExpiresAt() {
    return runtimeExpiresAt
}

/**
 * Updates runtime bearer token and persists it. Kept for callers that only ever manage the access
 * token in isolation; prefer {@link setTokens} after any call that also returns a refresh token.
 *
 * @param {string} token
 * @returns {void}
 */
export function setAccessToken(token) {
    const normalized = typeof token === 'string' ? token.trim() : ''
    runtimeToken = normalized
    writeStorage(STORAGE_KEY, normalized)
}

/**
 * Stores a fresh access/refresh token pair from an OTP exchange or a refresh-endpoint response,
 * replacing whatever was previously stored. Always call this with the *new* refresh token a refresh
 * call returned — the old one is invalidated server-side the instant it's used (rotation).
 *
 * @param {{ accessToken: string, refreshToken?: string|null, expiresIn?: number|string|null }} tokens
 *        `expiresIn` is seconds-until-expiry (the OAuth2 `expires_in` field); omit/null when unknown.
 * @returns {void}
 */
export function setTokens({ accessToken, refreshToken = '', expiresIn = null } = {}) {
    setAccessToken(accessToken)

    const normalizedRefresh = typeof refreshToken === 'string' ? refreshToken.trim() : ''
    runtimeRefreshToken = normalizedRefresh
    writeStorage(REFRESH_STORAGE_KEY, normalizedRefresh)

    const seconds = Number(expiresIn)
    runtimeExpiresAt = Number.isFinite(seconds) && seconds > 0 ? Date.now() + seconds * 1000 : 0
    writeStorage(EXPIRES_AT_STORAGE_KEY, runtimeExpiresAt ? String(runtimeExpiresAt) : '')
}

/**
 * Clears the access token, refresh token, and expiry — full sign-out.
 *
 * @returns {void}
 */
export function clearTokens() {
    setTokens({ accessToken: '', refreshToken: '', expiresIn: null })
}
