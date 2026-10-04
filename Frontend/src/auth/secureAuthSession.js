/**
 * @file Shared secure auth session: bearer token + visit/student ids for chatContext.
 * @module auth/secureAuthSession
 */

import {clearTokens, setTokens} from './tokenStore.js'
import {readJwtPersonaCode} from './jwtClaims.js'
import {setRuntimeVisitId, wipeLegacyRosterStudentId} from '../config/chatContext.js'
import {tryResolveVisitIdForCurrentUser} from './visitResolution.js'
import {tryResolveStudentIdForCurrentUser} from './studentResolution.js'
import {
    applyPersonaFromAccessToken,
    canonicalizePersona,
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
 * When the signed-in identity persona has no chat-context equivalent (e.g. {@code EMPLOYEE}, or
 * no persona at all) and neither a visit nor a student record resolves, this does **not** throw —
 * the OTP exchange already succeeded and the token is stored. It returns
 * {@code chatUnavailable: true} instead, so the caller can show an accurate "signed in, but no
 * chat for this account" message rather than treating a successful sign-in as a failure. A
 * chat-supported persona (VISITOR/STUDENT) with nothing resolved yet still throws — that case
 * is a genuine sync-delay the manual-visit-id fallback can recover from.
 *
 * @param {ImportMetaEnv} env
 * @param {string} accessToken
 * @param {{ refreshToken?: string|null, expiresIn?: number|string|null }} [tokenExtras]
 * @returns {Promise<{ accessToken: string, visitId: string|null, studentId: string|null, availablePersonas: Array<'VISITOR'|'STUDENT'>, chatUnavailable?: boolean, personaCode?: string|null }>}
 */
export async function completeSecureAuth(env, accessToken, tokenExtras = {}) {
    const normalized = String(accessToken ?? '').trim()
    if (!normalized) {
        throw new Error('Access token is required')
    }
    setTokens({accessToken: normalized, ...tokenExtras})
    wipeLegacyRosterStudentId()
    setActivePersona(null)
    // JWT claim wins over the previous "prefer Visitor when both exist" default.
    applyPersonaFromAccessToken(normalized)

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
        const personaCode = readJwtPersonaCode(normalized)
        if (!canonicalizePersona(personaCode)) {
            log.info('Signed in, but persona has no chat context', {personaCode})
            return {
                accessToken: normalized,
                visitId: null,
                studentId: null,
                availablePersonas: [],
                chatUnavailable: true,
                personaCode,
            }
        }
        throw new Error(
            "We couldn't find your visit or student details yet. If you just registered, please try again in a few minutes.",
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
