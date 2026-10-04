/**
 * @file Decode JWT payload claims from a bearer token the client already holds.
 * @module auth/jwtClaims
 *
 * Signatures are not verified here — the token was issued by our auth server over HTTPS.
 * Used to read {@code persona_code} that OTP verify stamped onto the access token.
 */

export const JWT_PERSONA_CODE_CLAIM = 'persona_code'

/**
 * @param {unknown} token
 * @returns {Record<string, unknown>|null}
 */
export function decodeJwtPayload(token) {
    const raw = String(token ?? '').trim()
    const parts = raw.split('.')
    if (parts.length < 2 || !parts[1]) return null
    try {
        const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
        const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
        const json = JSON.parse(atob(padded))
        return json && typeof json === 'object' ? json : null
    } catch {
        return null
    }
}

/**
 * @param {unknown} token
 * @returns {string|null} trimmed {@code persona_code} claim, or null when absent/blank
 */
export function readJwtPersonaCode(token) {
    const payload = decodeJwtPayload(token)
    const value = payload?.[JWT_PERSONA_CODE_CLAIM]
    if (value == null) return null
    const trimmed = String(value).trim()
    return trimmed ? trimmed : null
}
