/**
 * @file Shared secure auth session: bearer token + visit id for orchestration chatContext.
 * @module auth/secureAuthSession
 */

import { clearTokens, setTokens } from './tokenStore.js'
import { setRuntimeVisitId } from '../config/chatContext.js'
import { resolveVisitIdForCurrentUser } from './visitResolution.js'

/**
 * Clears bearer token, refresh token, and persisted visit id (env-specific state).
 */
export function clearSecureAuthSession() {
    clearTokens()
    setRuntimeVisitId(null)
}

/**
 * Stores the access/refresh token pair, resolves visit from my-visits APIs, persists visit id.
 *
 * @param {ImportMetaEnv} env
 * @param {string} accessToken
 * @param {{ refreshToken?: string|null, expiresIn?: number|string|null }} [tokenExtras]
 *        Refresh token + TTL from the OTP exchange response, when available.
 * @returns {Promise<{ accessToken: string, visitId: string }>}
 */
export async function completeSecureAuth(env, accessToken, tokenExtras = {}) {
    const normalized = String(accessToken ?? '').trim()
    if (!normalized) {
        throw new Error('Access token is required')
    }
    setTokens({ accessToken: normalized, ...tokenExtras })
    const visitId = await resolveVisitIdForCurrentUser(env, normalized)
    return { accessToken: normalized, visitId }
}
