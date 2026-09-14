/**
 * @file Shared secure auth session: bearer token + visit/student ids for chatContext.
 * @module auth/secureAuthSession
 */

import {clearTokens, setTokens} from './tokenStore.js'
import {setRuntimeVisitId, wipeLegacyRosterStudentId} from '../config/chatContext.js'
import {tryResolveVisitIdForCurrentUser} from './visitResolution.js'
import {tryResolveStudentIdForCurrentUser} from './studentResolution.js'
import {
    clearPersonaSession,
    ensureActivePersona,
    PERSONA_STUDENT,
    PERSONA_VISITOR,
    setActivePersona,
} from '../config/personaSession.js'
import {createLogger} from '../utils/logger.js'

const log = createLogger('secureAuthSession')

/**
 * Clears bearer token, refresh token, visit id, student id, and active persona.
 */
export function clearSecureAuthSession() {
    clearTokens()
    setRuntimeVisitId(null)
    clearPersonaSession()
}

/**
 * Stores the access/refresh token pair, resolves visit id, envelope userId from profile/me
 * (both personas), and STUDENT persona when OTP eligibility said STUDENT.
 *
 * Visit resolution uses few retries (not the 10×15s loop) so student-only accounts are not stalled.
 *
 * @param {ImportMetaEnv} env
 * @param {string} accessToken
 * @param {{ refreshToken?: string|null, expiresIn?: number|string|null }} [tokenExtras]
 * @returns {Promise<{ accessToken: string, visitId: string|null, studentId: string|null, availablePersonas: Array<'VISITOR'|'STUDENT'> }>}
 */
export async function completeSecureAuth(env, accessToken, tokenExtras = {}) {
    const normalized = String(accessToken ?? '').trim()
    if (!normalized) {
        throw new Error('Access token is required')
    }
    setTokens({accessToken: normalized, ...tokenExtras})
    wipeLegacyRosterStudentId()

    // Visit with 1 attempt (fast fail for student-only). tryResolveStudentId always loads
    // profile/me → dxpUserId (envelope userId); returns the id only when STUDENT-eligible.
    const [visitId, studentId] = await Promise.all([
        tryResolveVisitIdForCurrentUser(env, normalized, {attempts: 1, delayMs: 0}),
        tryResolveStudentIdForCurrentUser(env, normalized),
    ])

    const availablePersonas = []
    if (visitId) availablePersonas.push(PERSONA_VISITOR)
    if (studentId) availablePersonas.push(PERSONA_STUDENT)

    if (availablePersonas.length === 0) {
        throw new Error(
            'No visit or student record found for your account. Confirm eligibility and try again.',
        )
    }

    // Prefer restoring a prior valid choice; otherwise ensureActivePersona picks.
    const persona = ensureActivePersona()
    if (!persona && availablePersonas.length === 1) {
        setActivePersona(availablePersonas[0])
    }

    log.info('Secure auth complete', {
        hasVisit: Boolean(visitId),
        hasStudent: Boolean(studentId),
        persona: ensureActivePersona(),
    })

    return {
        accessToken: normalized,
        visitId: visitId ?? null,
        studentId: studentId ?? null,
        availablePersonas,
    }
}
