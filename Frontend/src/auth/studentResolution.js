/**
 * @file Resolves Identity user UUID ({@code UserDto.id} / {@code students.dxp_user_id})
 * for STUDENT chatContext. Does not call absence-info (roster PK).
 * @module auth/studentResolution
 */

import {resolveApiOrigin} from '../config/apiOrigin.js'
import {
    getStudentEligible,
    getRuntimeStudentId,
    normalizeContextId,
    setRuntimeStudentId,
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
 * (that endpoint always sends OTP).
 *
 * @param {unknown} data
 */
export function persistStudentEligibility(data) {
    setStudentEligible(isStudentEligibleResponse(data))
}

/**
 * Loads {@code GET .../identity/profile/me} {@code data.id} when OTP eligibility said STUDENT.
 *
 * @param {ImportMetaEnv} [env]
 * @param {string} accessToken
 * @returns {Promise<string|null>} Identity UUID or null
 */
export async function tryResolveStudentIdForCurrentUser(env = import.meta.env, accessToken) {
    wipeLegacyRosterStudentId()
    const token = String(accessToken ?? '').trim()
    if (!token) {
        log.warn('Bearer token required to resolve student chat id')
        return null
    }
    if (!getStudentEligible()) {
        setRuntimeStudentId(null)
        return null
    }

    const previous = getRuntimeStudentId() || null
    const origin = resolveApiOrigin(env)
    const url = `${origin}/api/v1/secure/identity/profile/me`

    try {
        const res = await fetch(url, {headers: authHeaders(token)})
        if (!res.ok) {
            log.warn('profile/me lookup failed; keeping stored student chat id', {status: res.status})
            return previous
        }
        const json = await res.json()
        const id = normalizeContextId(json?.data?.id)
        if (!id) {
            log.warn('profile/me returned no valid id; keeping stored student chat id')
            return previous
        }
        setRuntimeStudentId(id)
        log.info('Resolved STUDENT chat id from profile/me', {dxpUserId: id})
        return id
    } catch (err) {
        log.warn('Could not resolve student chat id; keeping stored value', err)
        return previous
    }
}
