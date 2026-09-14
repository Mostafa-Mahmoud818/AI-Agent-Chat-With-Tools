/**
 * @file Resolves Identity user UUID ({@code UserDto.id}) for chat envelope {@code userId}
 * and STUDENT persona eligibility. Does not call absence-info (roster PK).
 * @module auth/studentResolution
 */

import {resolveApiOrigin} from '../config/apiOrigin.js'
import {
    getStudentEligible,
    getRuntimeDxpUserId,
    normalizeContextId,
    setRuntimeDxpUserId,
    setStudentEligible,
    wipeLegacyRosterStudentId,
} from '../config/chatContext.js'
import {createLogger} from '../utils/logger.js'

const log = createLogger('studentResolution')

/**
 * @param {string} accessToken
 * @returns {Record<string, string>}
 */
function authHeaders(accessToken) {
    return {Authorization: `Bearer ${String(accessToken).trim()}`}
}

/**
 * @param {unknown} data check-eligibility {@code data}
 * @returns {boolean}
 */
export function isStudentEligibleResponse(data) {
    const personas = data?.personas
    const reasons = data?.reasons
    if (Array.isArray(personas) && personas.map(String).includes('STUDENT')) {
        return true
    }
    if (Array.isArray(reasons) && reasons.map(String).includes('STUDENT_EXISTS')) {
        return true
    }
    return false
}

/**
 * Persist STUDENT persona from OTP eligibility. Never re-POST check-eligibility on restore
 * (that endpoint always sends OTP). Does not clear {@code dxpUserId}.
 *
 * @param {unknown} data
 */
export function persistStudentEligibility(data) {
    setStudentEligible(isStudentEligibleResponse(data))
}

/**
 * Loads {@code GET .../identity/profile/me} {@code data.id} for envelope {@code userId}
 * (both VISITOR and STUDENT). Never gated on STUDENT eligibility — that would wipe Visitor userId.
 *
 * @param {ImportMetaEnv} [env]
 * @param {string} accessToken
 * @returns {Promise<string|null>} Identity UUID or null
 */
export async function tryResolveDxpUserIdForCurrentUser(env = import.meta.env, accessToken) {
    wipeLegacyRosterStudentId()
    const token = String(accessToken ?? '').trim()
    if (!token) {
        log.warn('Bearer token required to resolve envelope userId')
        return null
    }

    const previous = getRuntimeDxpUserId() || null
    const origin = resolveApiOrigin(env)
    const url = `${origin}/api/v1/secure/identity/profile/me`

    try {
        const res = await fetch(url, {headers: authHeaders(token)})
        if (!res.ok) {
            log.warn('profile/me lookup failed; keeping stored dxpUserId', {status: res.status})
            return previous
        }
        const json = await res.json()
        const id = normalizeContextId(json?.data?.id)
        if (!id) {
            log.warn('profile/me returned no valid id; keeping stored dxpUserId')
            return previous
        }
        setRuntimeDxpUserId(id)
        log.info('Resolved envelope userId from profile/me', {dxpUserId: id})
        return id
    } catch (err) {
        log.warn('Could not resolve envelope userId; keeping stored value', err)
        return previous
    }
}

/**
 * Resolves Identity UUID when STUDENT-eligible (persona gate). Always also refreshes
 * {@code dxpUserId} via {@link tryResolveDxpUserIdForCurrentUser} when eligible; when not
 * eligible, returns null without clearing {@code dxpUserId}.
 *
 * @param {ImportMetaEnv} [env]
 * @param {string} accessToken
 * @returns {Promise<string|null>}
 */
export async function tryResolveStudentIdForCurrentUser(env = import.meta.env, accessToken) {
    wipeLegacyRosterStudentId()
    const token = String(accessToken ?? '').trim()
    if (!token) {
        log.warn('Bearer token required to resolve student chat id')
        return null
    }
    // Always resolve dxpUserId for envelope userId (Visitor + Student).
    const dxpUserId = await tryResolveDxpUserIdForCurrentUser(env, token)
    if (!getStudentEligible()) {
        return null
    }
    return dxpUserId
}
