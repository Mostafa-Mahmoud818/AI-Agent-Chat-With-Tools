/**
 * Stable guest {@code clientId} for public chatting APIs (UUID string).
 * Matches server cookie name {@code chatting.guest-cookie-name} (default {@code ankabut_guest_id}).
 *
 * @module auth/guestClientId
 */

const STORAGE_KEY = 'ankabut.chat.guestClientId'
const DEFAULT_COOKIE_NAME = 'ankabut_guest_id'

/**
 * @returns {string} cookie name sent by the browser (unsigned UUID when server has no HMAC secret).
 */
export function getGuestCookieName() {
    const n = import.meta.env?.VITE_GUEST_COOKIE_NAME
    return typeof n === 'string' && n.trim() ? n.trim() : DEFAULT_COOKIE_NAME
}

/**
 * @returns {string} UUID for {@code clientId} query/body on public endpoints
 */
export function getOrCreateGuestClientId() {
    try {
        let id = localStorage.getItem(STORAGE_KEY)?.trim()
        if (!id) {
            id = crypto.randomUUID()
            localStorage.setItem(STORAGE_KEY, id)
        }
        return id
    } catch {
        // Storage blocked (e.g. private mode); ephemeral id — retries may not dedupe.
        return crypto.randomUUID()
    }
}

/**
 * Sets a first-party cookie so proxied requests can satisfy {@link GuestClientIdResolver} without query params.
 * Safe when modulith uses no {@code chatting.guest-hmac-secret} (plain UUID cookie).
 */
export function syncGuestCookie() {
    if (typeof document === 'undefined') return
    const name = getGuestCookieName()
    const id = getOrCreateGuestClientId()
    const maxAge = 60 * 60 * 24 * 400
    document.cookie = `${name}=${id}; Path=/; Max-Age=${maxAge}; SameSite=Lax`
}
