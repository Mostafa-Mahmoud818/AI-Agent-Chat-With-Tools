/**
 * @file Active chat persona (VISITOR | STUDENT) and orchestration start envelope.
 * @module config/personaSession
 *
 * The persona is fixed at sign-in: when the access token carries a chat-supported
 * {@code persona_code} claim, that persona is always the active one ({@link getLockedPersona}).
 * Stored choices and {@code ?persona=} cannot switch it — the user signs out and signs in as the
 * other persona. Tokens without the claim (CI bearer, non-OTP logins) fall back to the
 * resolved-context rules below.
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
import {readJwtPersonaCode} from '../auth/jwtClaims.js'
import {getAccessToken} from '../auth/tokenStore.js'
import {createLogger} from '../utils/logger.js'

const log = createLogger('personaSession')

export const PERSONA_VISITOR = CHAT_CONTEXT_TYPE_VISITOR
/** @deprecated Prefer {@link PERSONA_VISITOR}; equals VISITOR for one-release localStorage/query. */
export const PERSONA_VISIT = PERSONA_VISITOR
export const PERSONA_STUDENT = CHAT_CONTEXT_TYPE_STUDENT

/**
 * Identity {@code persona_code} from check-eligibility / JWT. Maps legacy {@code VISIT} → {@code VISITOR};
 * other codes (STUDENT, EMPLOYEE, …) are uppercased as-is.
 *
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeIdentityPersonaCode(raw) {
    if (raw == null) return null
    const t = String(raw).trim().toUpperCase()
    if (!t) return null
    if (t === 'VISIT' || t === 'VISITOR') return PERSONA_VISITOR
    return t
}

/**
 * Chat-supported personas only ({@code VISITOR} | {@code STUDENT}).
 *
 * @param {unknown} raw
 * @returns {'VISITOR'|'STUDENT'|null}
 */
export function canonicalizePersona(raw) {
    const code = normalizeIdentityPersonaCode(raw)
    if (code === PERSONA_VISITOR || code === PERSONA_STUDENT) return code
    return null
}

/**
 * Deduped, canonical identity persona codes from a check-eligibility {@code personas} array.
 *
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normalizeEligiblePersonas(raw) {
    if (!Array.isArray(raw)) return []
    const seen = new Set()
    const out = []
    for (const item of raw) {
        const code = normalizeIdentityPersonaCode(item)
        if (!code || seen.has(code)) continue
        seen.add(code)
        out.push(code)
    }
    return out
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
export function personaDisplayName(raw) {
    const code = normalizeIdentityPersonaCode(raw)
    if (code === PERSONA_VISITOR) return 'Visitor'
    if (code === PERSONA_STUDENT) return 'Student'
    if (!code) return ''
    return code.charAt(0) + code.slice(1).toLowerCase()
}

/**
 * Applies the access-token {@code persona_code} claim as the active chat persona when it is a
 * chat-supported code. Called after OTP verify and on session restore so the JWT selection wins
 * over the previous "prefer Visitor when both exist" default.
 *
 * @param {unknown} accessToken
 * @returns {'VISITOR'|'STUDENT'|null}
 */
export function applyPersonaFromAccessToken(accessToken) {
    const canonical = canonicalizePersona(readJwtPersonaCode(accessToken))
    if (canonical) setActivePersona(canonical)
    return canonical
}

/**
 * Chat persona fixed at sign-in by the current access token's {@code persona_code} claim.
 *
 * @returns {'VISITOR'|'STUDENT'|null} null when the token has no chat-supported persona
 */
export function getLockedPersona() {
    return canonicalizePersona(readJwtPersonaCode(getAccessToken()))
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
 * Personas for which we have a resolved context id. When the persona is locked by the token, only
 * that persona can be available.
 *
 * @returns {Array<'VISITOR'|'STUDENT'>}
 */
export function getAvailablePersonas() {
    const available = []
    if (hasConfiguredVisitId()) available.push(PERSONA_VISITOR)
    if (hasConfiguredStudentId()) available.push(PERSONA_STUDENT)
    const locked = getLockedPersona()
    return locked ? available.filter((p) => p === locked) : available
}

/**
 * Picks the active persona. A token-locked persona always wins, even before its context id has
 * resolved (callers then show that persona's missing-context hint, never the other persona).
 * Without a lock: restore last choice if still available, else sole available, else null.
 *
 * @returns {'VISITOR'|'STUDENT'|null}
 */
export function resolveActivePersona() {
    const locked = getLockedPersona()
    if (locked) return locked

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
 * {@code ?persona=} is ignored when it names a different persona than the token-locked one.
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
        const locked = getLockedPersona()
        if (canonical && locked && canonical !== locked) {
            log.info('Ignored ?persona= override; persona is fixed by sign-in', {requested: canonical, locked})
        } else if (canonical) {
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
