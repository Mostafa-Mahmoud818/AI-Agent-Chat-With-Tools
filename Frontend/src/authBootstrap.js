/**
 * @file Startup validation for secure chatting env (email OTP auth or optional bootstrap token).
 * @module authBootstrap
 */

import { createLogger } from './utils/logger.js'
import { applyPersonaFromAccessToken, applyPersonaQueryOverrides, ensureActivePersona } from './config/personaSession.js'
import { getAccessToken, initTokenStore } from './auth/tokenStore.js'
import { tryResolveDxpUserIdForCurrentUser } from './auth/studentResolution.js'
import { wipeLegacyRosterStudentId } from './config/chatContext.js'
import { beginUaePassCallback } from './auth/uaePassFlow.js'

const log = createLogger('authBootstrap')

/**
 * Initializes runtime auth state from env/storage.
 *
 * @returns {Promise<void>}
 */
export async function applySecureChatEnv() {
    if (import.meta.env.MODE === 'test') return

    // Must run before initTokenStore so a session cleared by a UAE PASS callback is not loaded.
    beginUaePassCallback(import.meta.env)
    initTokenStore(import.meta.env)
    wipeLegacyRosterStudentId()
    applyPersonaFromAccessToken(getAccessToken())
    applyPersonaQueryOverrides()

    const token = getAccessToken()
    if (!token) {
        log.info('No bearer token yet — sign in via email OTP in the auth dialog.')
        ensureActivePersona()
        return
    }
    await tryResolveDxpUserIdForCurrentUser(import.meta.env, token)
    ensureActivePersona()
}
