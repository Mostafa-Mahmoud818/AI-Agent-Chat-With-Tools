/**
 * Chat API auth mode: secure (JWT bearer) vs public guest (clientId + optional cookie).
 * Aligns with Ankabut modulith {@code ChattingSecureController} vs {@code ChattingOpenController}.
 *
 * @module config/chatAuth
 */

/**
 * @param {Record<string, string | boolean | undefined>} [env] defaults to `import.meta.env`
 * @returns {boolean} true when using {@code /api/v1/public/chatting} without bearer
 */
export function isGuestChatAuth(env = import.meta.env) {
    const v = env.VITE_CHAT_AUTH
    return v === 'guest' || String(v).toLowerCase() === 'guest'
}
