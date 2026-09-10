/**
 * @file Active chat persona (VISIT | STUDENT) and orchestration start envelope.
 * @module config/personaSession
 */

import {
    ACTIVE_PERSONA_STORAGE_KEY,
    buildStudentChatContext,
    buildVisitChatContext,
    CHAT_CONTEXT_TYPE_STUDENT,
    CHAT_CONTEXT_TYPE_VISIT,
    getRuntimeStudentId,
    getRuntimeVisitId,
    hasConfiguredStudentId,
    hasConfiguredVisitId,
    isPlaceholderVisitId,
    normalizeContextId,
    OTHER_CONTEXT_COMPOSER_PLACEHOLDER,
    OTHER_CONTEXT_READONLY_MESSAGE,
    OTHER_VISIT_COMPOSER_PLACEHOLDER,
    OTHER_VISIT_READONLY_MESSAGE,
    resolveVisitId,
    setRuntimeStudentId,
    setStudentEligible,
    getVisitChatContextForStart,
} from './chatContext.js'
import {createLogger} from '../utils/logger.js'

const log = createLogger('personaSession')

export const PERSONA_VISIT = CHAT_CONTEXT_TYPE_VISIT
export const PERSONA_STUDENT = CHAT_CONTEXT_TYPE_STUDENT

/**
 * @returns {'VISIT'|'STUDENT'|null}
 */
export function getActivePersona() {
    try {
        const raw = localStorage.getItem(ACTIVE_PERSONA_STORAGE_KEY)?.trim()?.toUpperCase()
        if (raw === PERSONA_VISIT || raw === PERSONA_STUDENT) return raw
    } catch {
        // ignore
    }
    return null
}

/**
 * @param {'VISIT'|'STUDENT'|null|undefined} persona
 */
export function setActivePersona(persona) {
    try {
        if (persona !== PERSONA_VISIT && persona !== PERSONA_STUDENT) {
            localStorage.removeItem(ACTIVE_PERSONA_STORAGE_KEY)
            return
        }
        localStorage.setItem(ACTIVE_PERSONA_STORAGE_KEY, persona)
    } catch {
        // private mode / quota
    }
}

/**
 * Personas for which we have a resolved context id.
 *
 * @returns {Array<'VISIT'|'STUDENT'>}
 */
export function getAvailablePersonas() {
    const available = []
    if (hasConfiguredVisitId()) available.push(PERSONA_VISIT)
    if (hasConfiguredStudentId()) available.push(PERSONA_STUDENT)
    return available
}

/**
 * Picks an active persona: restore last choice if still available, else sole available, else null.
 *
 * @returns {'VISIT'|'STUDENT'|null}
 */
export function resolveActivePersona() {
    const available = getAvailablePersonas()
    if (available.length === 0) return null

    const stored = getActivePersona()
    if (stored && available.includes(stored)) return stored

    // Prefer VISIT when both exist and no prior choice (existing visitor UX).
    if (available.includes(PERSONA_VISIT) && available.includes(PERSONA_STUDENT)) {
        return PERSONA_VISIT
    }
    return available[0]
}

/**
 * Ensures active persona is set to a valid choice given current ids.
 *
 * @returns {'VISIT'|'STUDENT'|null}
 */
export function ensureActivePersona() {
    const persona = resolveActivePersona()
    setActivePersona(persona)
    return persona
}

/**
 * Whether the active persona has a usable context id for orchestration start.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {boolean}
 */
export function hasConfiguredActivePersonaContext(env = import.meta.env) {
    const persona = resolveActivePersona()
    if (persona === PERSONA_STUDENT) return hasConfiguredStudentId()
    if (persona === PERSONA_VISIT) return hasConfiguredVisitId(env)
    return false
}

/**
 * Wire payload for orchestration start based on active persona.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {{ schemaVersion: string, contextType: string, contextData: { id: string } }}
 */
export function getChatContextForStart(env = import.meta.env) {
    const persona = ensureActivePersona()
    if (persona === PERSONA_STUDENT) {
        const studentId = getRuntimeStudentId()
        if (!studentId) {
            throw new Error('Student id is required for STUDENT chatContext')
        }
        return buildStudentChatContext(studentId)
    }
    // Default / VISIT
    return getVisitChatContextForStart(env)
}

/**
 * True when the conversation's frozen context does not match the active persona + id.
 *
 * @param {{ contextType?: string|null, contextTypeId?: string|null }|null|undefined} conversation
 * @param {ImportMetaEnv} [env]
 * @returns {boolean}
 */
export function isOtherContextConversation(conversation, env = import.meta.env) {
    if (!conversation || !conversation.contextType) return false
    const type = String(conversation.contextType).trim().toUpperCase()
    const contextId = normalizeContextId(conversation.contextTypeId)
    if (!contextId) return false

    const active = resolveActivePersona()
    if (!active) return false

    if (type === PERSONA_VISIT) {
        if (active !== PERSONA_VISIT) return true
        const currentVisitId = resolveVisitId(env)
        if (isPlaceholderVisitId(currentVisitId)) return false
        return contextId !== currentVisitId
    }

    if (type === PERSONA_STUDENT) {
        if (active !== PERSONA_STUDENT) return true
        const currentStudentId = getRuntimeStudentId()
        if (!currentStudentId) return false
        return contextId !== currentStudentId
    }

    return false
}

/**
 * @param {{ contextType?: string|null, contextTypeId?: string|null }|null|undefined} conversation
 * @returns {string}
 */
export function getOtherContextReadonlyMessage(conversation) {
    if (conversation?.contextType === PERSONA_VISIT) {
        return OTHER_VISIT_READONLY_MESSAGE
    }
    return OTHER_CONTEXT_READONLY_MESSAGE
}

/**
 * @param {{ contextType?: string|null }|null|undefined} conversation
 * @returns {string}
 */
export function getOtherContextComposerPlaceholder(conversation) {
    if (conversation?.contextType === PERSONA_VISIT) {
        return OTHER_VISIT_COMPOSER_PLACEHOLDER
    }
    return OTHER_CONTEXT_COMPOSER_PLACEHOLDER
}

/**
 * Apply optional QA query overrides: {@code ?persona=STUDENT|VISIT}, {@code ?studentId=}.
 *
 * {@code ?studentId=<uuid>} only marks STUDENT eligibility (same as OTP
 * {@code STUDENT}/{@code STUDENT_EXISTS}). Chat id always comes from
 * {@code GET .../identity/profile/me} — a query UUID cannot pass start ownership
 * unless it equals the signed-in Identity user id.
 */
export function applyPersonaQueryOverrides() {
    if (typeof window === 'undefined') return
    try {
        const params = new URLSearchParams(window.location.search)
        const studentOverride = normalizeContextId(params.get('studentId') || params.get('student_id'))
        if (studentOverride) {
            setStudentEligible(true)
            log.info('Applied ?studentId= eligibility override; chat id comes from profile/me')
        }
        const personaRaw = params.get('persona')?.trim()?.toUpperCase()
        if (personaRaw === PERSONA_VISIT || personaRaw === PERSONA_STUDENT) {
            setActivePersona(personaRaw)
            log.info('Applied ?persona= override', {persona: personaRaw})
        }
    } catch {
        // ignore
    }
}

/**
 * Clears persona-related localStorage (used by secure session clear).
 */
export function clearPersonaSession() {
    setActivePersona(null)
    setStudentEligible(false)
    setRuntimeStudentId(null)
    // visit id cleared by clearSecureAuthSession via setRuntimeVisitId(null)
}

export {buildVisitChatContext, buildStudentChatContext, getRuntimeVisitId, getRuntimeStudentId}
