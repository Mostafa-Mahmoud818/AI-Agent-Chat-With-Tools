/**
 * @file Startup validation for secure chatting env (`VITE_API_BEARER_TOKEN`, optional `VITE_API_ORIGIN` / `VITE_API_BACKEND`).
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
        log.error(
            'Missing bearer token. Provide VITE_API_BEARER_TOKEN, authenticate via local OTP UI, or set VITE_CHAT_AUTH=guest.',
        )
    }
}
