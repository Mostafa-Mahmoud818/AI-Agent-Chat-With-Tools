/**
 * @file Shared secure auth session: bearer token + visit id for orchestration chatContext.
 * @module auth/secureAuthSession
 */

import { setAccessToken } from './tokenStore.js'
import { setRuntimeVisitId } from '../config/chatContext.js'
import { resolveVisitIdForCurrentUser } from './visitResolution.js'

/**
 * Clears bearer token and persisted visit id (env-specific state).
 */
export function clearSecureAuthSession() {
    setAccessToken('')
    setRuntimeVisitId(null)
}

/**
 * Stores token, resolves visit from my-visits APIs, persists visit id.
 *
 * @param {ImportMetaEnv} env
 * @param {string} accessToken
 * @returns {Promise<{ accessToken: string, visitId: string }>}
 */
export async function completeSecureAuth(env, accessToken) {
    const normalized = String(accessToken ?? '').trim()
    if (!normalized) {
        throw new Error('Access token is required')
    }
    setAccessToken(normalized)
    const visitId = await resolveVisitIdForCurrentUser(env, normalized)
    return { accessToken: normalized, visitId }
}
