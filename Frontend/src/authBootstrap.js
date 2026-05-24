/**
 * @file Startup validation for secure chatting env (email OTP auth or optional bootstrap token).
 * @module authBootstrap
 */

import { createLogger } from './utils/logger.js'
import { getAccessToken, initTokenStore } from './auth/tokenStore.js'
import { isGuestChatAuth } from './config/chatAuth.js'

const log = createLogger('authBootstrap')

/**
 * Initializes runtime auth state from env/storage.
 *
 * @returns {Promise<void>}
 */
export async function applySecureChatEnv() {
    if (import.meta.env.MODE === 'test') return

    initTokenStore(import.meta.env)

    if (isGuestChatAuth(import.meta.env)) {
        log.info('Public guest chatting (VITE_CHAT_AUTH=guest); bearer token not required.')
        return
    }

    const token = getAccessToken()
    if (!token) {
        log.info('No bearer token yet — sign in via email OTP in the auth dialog.')
    }
}
