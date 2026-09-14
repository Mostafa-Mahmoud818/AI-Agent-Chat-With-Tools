/**
 * @file Active chat persona (VISITOR | STUDENT) and orchestration start envelope.
 * @module config/personaSession
 */

import {
    ACTIVE_PERSONA_STORAGE_KEY,
    buildStudentChatContext,
    buildVisitChatContext,
    CHAT_CONTEXT_TYPE_STUDENT,
    CHAT_CONTEXT_TYPE_VISITOR,
    getRuntimeDxpUserId,
    getRuntimeVisitId,
    getStudentIdRequiredMessage,
    getUserIdRequiredMessage,
    getVisitChatContextForStart,
    getVisitIdRequiredMessage,
    hasConfiguredDxpUserId,
    hasConfiguredStudentId,
    hasConfiguredVisitId,
    isPlaceholderVisitId,
    isVisitorContextType,
    normalizeContextId,
    OTHER_CONTEXT_COMPOSER_PLACEHOLDER,
    OTHER_CONTEXT_READONLY_MESSAGE,
    OTHER_VISIT_COMPOSER_PLACEHOLDER,
    OTHER_VISIT_READONLY_MESSAGE,
    resolveVisitId,
    setRuntimeDxpUserId,
    setStudentEligible,
} from './chatContext.js'
import {createLogger} from '../utils/logger.js'

const log = createLogger('personaSession')

export const PERSONA_VISITOR = CHAT_CONTEXT_TYPE_VISITOR
/** @deprecated Prefer {@link PERSONA_VISITOR}; equals VISITOR for one-release localStorage/query. */
export const PERSONA_VISIT = PERSONA_VISITOR
export const PERSONA_STUDENT = CHAT_CONTEXT_TYPE_STUDENT

/**
 * @param {unknown} raw
 * @returns {'VISITOR'|'STUDENT'|null}
 */
function canonicalizePersona(raw) {
    if (raw == null) return null
    const t = String(raw).trim().toUpperCase()
    if (t === 'VISITOR' || t === 'VISIT') return PERSONA_VISITOR
    if (t === 'STUDENT') return PERSONA_STUDENT
    return null
}

/**
 * @returns {'VISITOR'|'STUDENT'|null}
 */
export function getActivePersona() {
    try {
        return canonicalizePersona(localStorage.getItem(ACTIVE_PERSONA_STORAGE_KEY))
    } catch {
        return null
    }
}

/**
 * @param {'VISITOR'|'VISIT'|'STUDENT'|null|undefined} persona
 */
export function setActivePersona(persona) {
    try {
        const canonical = canonicalizePersona(persona)
        if (!canonical) {
            localStorage.removeItem(ACTIVE_PERSONA_STORAGE_KEY)
            return
        }
        localStorage.setItem(ACTIVE_PERSONA_STORAGE_KEY, canonical)
    } catch {
        // private mode / quota
    }
}

/**
 * Personas for which we have a resolved context id.
 *
 * @returns {Array<'VISITOR'|'STUDENT'>}
 */
export function getAvailablePersonas() {
    const available = []
    if (hasConfiguredVisitId()) available.push(PERSONA_VISITOR)
    if (hasConfiguredStudentId()) available.push(PERSONA_STUDENT)
    return available
}

/**
 * Picks an active persona: restore last choice if still available, else sole available, else null.
 *
 * @returns {'VISITOR'|'STUDENT'|null}
 */
export function resolveActivePersona() {
    const available = getAvailablePersonas()
    if (available.length === 0) return null

    const stored = getActivePersona()
    if (stored && available.includes(stored)) return stored

    // Prefer VISITOR when both exist and no prior choice (existing visitor UX).
    if (available.includes(PERSONA_VISITOR) && available.includes(PERSONA_STUDENT)) {
        return PERSONA_VISITOR
    }
    return available[0]
}

/**
 * Ensures active persona is set to a valid choice given current ids.
 *
 * @returns {'VISITOR'|'STUDENT'|null}
 */
export function ensureActivePersona() {
    const persona = resolveActivePersona()
    setActivePersona(persona)
    return persona
}

/**
 * Whether the active persona has a usable context id <b>and</b> envelope userId for start.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {boolean}
 */
export function hasConfiguredActivePersonaContext(env = import.meta.env) {
    if (!hasConfiguredDxpUserId(env)) return false
    const persona = resolveActivePersona()
    if (persona === PERSONA_STUDENT) return hasConfiguredStudentId()
    if (persona === PERSONA_VISITOR) return hasConfiguredVisitId(env)
    return false
}

/**
 * Message to show when {@link hasConfiguredActivePersonaContext} is false: prefer the
 * userId-missing copy when that is the gap, else the active persona's visit/student copy.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {string} required-context message
 */
export function getActivePersonaContextGapMessage(env = import.meta.env) {
    if (!hasConfiguredDxpUserId(env)) return getUserIdRequiredMessage()
    const persona = resolveActivePersona()
    if (persona === PERSONA_STUDENT) return getStudentIdRequiredMessage()
    return getVisitIdRequiredMessage()
}

/**
 * Wire payload for orchestration start based on active persona.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {{ schemaVersion: string, contextType: string, userId: string, contextData: object }}
 */
export function getChatContextForStart(env = import.meta.env) {
    const persona = ensureActivePersona()
    if (persona === PERSONA_STUDENT) {
        const userId = getRuntimeDxpUserId() || undefined
        return buildStudentChatContext(userId, env)
    }
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
    // New / not-yet-started conversations have no frozen contextType — always editable.
    if (!conversation || !conversation.contextType) return false
    const type = String(conversation.contextType).trim().toUpperCase()
    const contextId = normalizeContextId(conversation.contextTypeId)
    if (!contextId) return false

    const active = resolveActivePersona()
    if (!active) return false

    if (isVisitorContextType(type)) {
        if (active !== PERSONA_VISITOR) return true
        const currentVisitId = resolveVisitId(env)
        if (isPlaceholderVisitId(currentVisitId)) return false
        return contextId !== currentVisitId
    }

    if (type === PERSONA_STUDENT) {
        if (active !== PERSONA_STUDENT) return true
        const currentUserId = getRuntimeDxpUserId()
        if (!currentUserId) return false
        return contextId !== currentUserId
    }

    return false
}

/**
 * @param {{ contextType?: string|null, contextTypeId?: string|null }|null|undefined} conversation
 * @returns {string}
 */
export function getOtherContextReadonlyMessage(conversation) {
    if (isVisitorContextType(conversation?.contextType)) {
        return OTHER_VISIT_READONLY_MESSAGE
    }
    return OTHER_CONTEXT_READONLY_MESSAGE
}

/**
 * @param {{ contextType?: string|null }|null|undefined} conversation
 * @returns {string}
 */
export function getOtherContextComposerPlaceholder(conversation) {
    if (isVisitorContextType(conversation?.contextType)) {
        return OTHER_VISIT_COMPOSER_PLACEHOLDER
    }
    return OTHER_CONTEXT_COMPOSER_PLACEHOLDER
}

/**
 * Apply optional QA query overrides: {@code ?persona=STUDENT|VISITOR|VISIT}, {@code ?studentId=}.
 *
 * {@code ?studentId=<uuid>} only marks STUDENT eligibility (same as OTP
 * {@code STUDENT}/{@code STUDENT_EXISTS}). Envelope {@code userId} always comes from
 * {@code GET .../identity/profile/me}.
 */
export function applyPersonaQueryOverrides() {
    if (typeof window === 'undefined') return
    try {
        const params = new URLSearchParams(window.location.search)
        const studentOverride = normalizeContextId(params.get('studentId') || params.get('student_id'))
        if (studentOverride) {
            setStudentEligible(true)
            log.info('Applied ?studentId= eligibility override; chat userId comes from profile/me')
        }
        const personaRaw = params.get('persona')?.trim()?.toUpperCase()
        const canonical = canonicalizePersona(personaRaw)
        if (canonical) {
            setActivePersona(canonical)
            log.info('Applied ?persona= override', {persona: canonical})
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
    setRuntimeDxpUserId(null)
    // visit id cleared by clearSecureAuthSession via setRuntimeVisitId(null)
}

export {
    buildVisitChatContext,
    buildStudentChatContext,
    getRuntimeVisitId,
    getRuntimeDxpUserId,
    getRuntimeStudentId,
} from './chatContext.js'
