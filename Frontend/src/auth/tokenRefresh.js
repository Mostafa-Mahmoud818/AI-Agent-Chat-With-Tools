/**
 * @file Access-token refresh via the identity refresh-token endpoint.
 * @module auth/tokenRefresh
 *
 * The OTP token exchange (`otpAccessTokenFlow.js`) returns an access token (~24h TTL per the
 * backend's seeded config) alongside a refresh token (~7-day TTL). The refresh endpoint
 * (`POST /api/v1/public/identity/auth/token/refresh`, body `{ refreshToken }`) is public and
 * returns the same `{ access_token, refresh_token, expires_in, ... }` shape as the OTP exchange.
 *
 * The refresh token is one-time-use: the server rotates it on every successful call and the old
 * value stops working immediately. Two things follow from that:
 * - Concurrent callers must share a single in-flight refresh (see {@link inFlightRefresh}) so the
 *   token is never spent twice for one logical refresh.
 * - A failed refresh means the session cannot be recovered client-side; the stored tokens are
 *   cleared so the app falls back to the OTP sign-in flow.
 */

import { resolveModulithRequestBase } from '../config/apiOrigin.js'
import { createLogger } from '../utils/logger.js'
import {
    clearTokens,
    getAccessToken,
    getAccessTokenExpiresAt,
    reloadPersistedRefreshToken,
    setTokens,
} from './tokenStore.js'

const log = createLogger('tokenRefresh')

/** Refresh this many ms before the recorded expiry, to absorb request latency and clock drift. */
const EXPIRY_SAFETY_MARGIN_MS = 30_000

/** Shared promise for an in-progress refresh call, so a rotating refresh token is spent once. */
let inFlightRefresh = null

function isAccessTokenExpired() {
    const expiresAt = getAccessTokenExpiresAt()
    // 0 = unknown expiry (env-bootstrapped token, or a sign-in that didn't return expires_in) —
    // never force a refresh purely from that; a 401 will still trigger the reactive retry.
    if (!expiresAt) return false
    return Date.now() >= expiresAt - EXPIRY_SAFETY_MARGIN_MS
}

/**
 * Exchanges the stored refresh token for a new access/refresh token pair and persists both,
 * replacing whatever was stored before. Concurrent callers all await the same underlying request.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<string>} the new access token
 * @throws {Error} when no refresh token is stored, or the backend rejects it (expired, already
 *         used, or revoked). A rejection clears the stored tokens, unless another tab rotated the
 *         token in the meantime — that replacement is left intact rather than signing both tabs out.
 */
export function refreshAccessToken(env) {
    if (inFlightRefresh) return inFlightRefresh

    // Re-read rather than trusting the runtime copy: another tab may have rotated the token since
    // this one booted, and sending its stale value is an automatic invalid_grant.
    const refreshToken = reloadPersistedRefreshToken()
    if (!refreshToken) {
        return Promise.reject(new Error('No refresh token available; sign in again.'))
    }

    inFlightRefresh = (async () => {
        const base = resolveModulithRequestBase(env)
        let res
        try {
            res = await fetch(`${base}/api/v1/public/identity/auth/token/refresh`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ refreshToken }),
            })
        } catch (err) {
            // Network failure: leave the (still possibly valid) refresh token in place so a
            // later retry — e.g. the user regains connectivity — can still use it.
            log.warn('Token refresh network failure', err)
            throw err
        }

        let json = null
        try {
            json = await res.json()
        } catch {
            json = null
        }

        if (!res.ok || json?.success === false) {
            // A rejected one-time-use token means this session is dead (expired, already rotated,
            // or revoked), so clear and let the app re-prompt sign-in — but only if the token we
            // spent is still the stored one. When two tabs race, the loser lands here *after* the
            // winner has persisted a working replacement; clearing unconditionally would sign both
            // tabs out over a refresh that in fact succeeded.
            if (reloadPersistedRefreshToken() === refreshToken) {
                clearTokens()
            }
            // The refresh endpoint passes the identity provider's OAuth2 error body through
            // verbatim (`{ error, error_description }`) rather than wrapping it in the modulith's
            // `{ success, message }` envelope, so read both shapes — `invalid_grant` here means the
            // token was expired, already rotated, or revoked.
            const message =
                json?.message ||
                json?.error_description ||
                json?.error ||
                `Token refresh failed with status ${res.status}`
            log.warn('Token refresh rejected', { status: res.status, message })
            throw new Error(message)
        }

        const accessToken = json?.data?.access_token
        const newRefreshToken = json?.data?.refresh_token
        const expiresIn = json?.data?.expires_in
        if (!accessToken || !newRefreshToken) {
            clearTokens()
            throw new Error('Refresh response missing access_token/refresh_token')
        }

        setTokens({ accessToken, refreshToken: newRefreshToken, expiresIn })
        log.info('Access token refreshed')
        return String(accessToken).trim()
    })()

    return inFlightRefresh.finally(() => {
        inFlightRefresh = null
    })
}

/**
 * Returns a usable access token, proactively refreshing first when the stored one is expired (or
 * about to be) and a refresh token is available. Never throws for the "never signed in" case —
 * callers that need to distinguish that from an expired/unrefreshable session should also check
 * {@link ../tokenStore.js#getRefreshToken}.
 *
 * A request that still gets a 401 despite a token this function judged "fresh" (clock skew, or a
 * genuinely revoked token) should call {@link refreshAccessToken} directly to force a retry —
 * this function will otherwise keep returning the same token until the recorded expiry passes.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<string>} current or refreshed access token; `''` when never signed in
 */
export async function ensureFreshAccessToken(env) {
    const current = getAccessToken()
    if (!current || !isAccessTokenExpired()) {
        return current
    }
    return refreshAccessToken(env)
}
