/**
 * @file Startup validation for secure chatting env (email OTP auth or optional bootstrap token).
 * @module authBootstrap
 */

import { createLogger } from './utils/logger.js'
import { applyPersonaQueryOverrides, ensureActivePersona } from './config/personaSession.js'
import { getAccessToken, initTokenStore } from './auth/tokenStore.js'
import { tryResolveStudentIdForCurrentUser } from './auth/studentResolution.js'
import { wipeLegacyRosterStudentId } from './config/chatContext.js'

const log = createLogger('authBootstrap')

/**
 * Initializes runtime auth state from env/storage.
 *
 * @returns {Promise<void>}
 */
export async function applySecureChatEnv() {
    if (import.meta.env.MODE === 'test') return

    initTokenStore(import.meta.env)
    wipeLegacyRosterStudentId()
    applyPersonaQueryOverrides()

    const token = getAccessToken()
    if (!token) {
        log.info('No bearer token yet — sign in via email OTP in the auth dialog.')
        ensureActivePersona()
        return
    }
    await tryResolveStudentIdForCurrentUser(import.meta.env, token)
    ensureActivePersona()
}
