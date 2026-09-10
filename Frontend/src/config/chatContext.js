/**
 * @file User-persona `chatContext` envelope helpers for orchestration start.
 * @module config/chatContext
 *
 * Mirrors backend {@code ChatContext} + {@code VisitContextData} / {@code StudentContextData}:
 * {@code { schemaVersion: "1.0", contextType: "VISIT"|"STUDENT", contextData: { id: "<uuid>" } } }.
 * Sent only on {@code POST .../orchestration/conversations/{id}/start}; follow-ups omit it.
 *
 * Visit id resolution (first match wins):
 * 1. URL query {@code ?visitId=} or {@code ?visit_id=}
 * 2. {@code localStorage} ({@link STORAGE_KEY})
 * 3. {@code VITE_DEFAULT_VISIT_ID}
 * 4. {@link DEFAULT_VISIT_ID} — treated as unconfigured
 */

import {createLogger} from '../utils/logger.js'

const log = createLogger('chatContext')

export const CHAT_CONTEXT_SCHEMA_VERSION = '1.0'
export const CHAT_CONTEXT_TYPE_VISIT = 'VISIT'
export const CHAT_CONTEXT_TYPE_STUDENT = 'STUDENT'
export const STORAGE_KEY = 'ankabut.chat.visitId'
/** Identity user UUID (`UserDto.id` / `students.dxp_user_id`). */
export const STUDENT_STORAGE_KEY = 'ankabut.chat.dxpUserId'
/** Pre-cutover roster PK; wiped on read/write and must never be sent as chatContext.id. */
export const LEGACY_STUDENT_STORAGE_KEY = 'ankabut.chat.studentId'
export const STUDENT_ELIGIBLE_STORAGE_KEY = 'ankabut.chat.studentEligible'
export const ACTIVE_PERSONA_STORAGE_KEY = 'ankabut.chat.activePersona'

/** Sentinel when no visit is configured; not sent to orchestration start. */
export const DEFAULT_VISIT_ID = '00000000-0000-0000-0000-000000000000'

/** Shown when visit id is not configured. */
export const VISIT_ID_REQUIRED_MESSAGE_SECURE =
    'No visit found for your account. Sign in again so the app can load your visit from the server, or use ?visitId= with a valid UUID.'

export const STUDENT_ID_REQUIRED_MESSAGE =
    'No student record found for your account. Sign in with a student-linked email, or switch to Visitor persona if you have visits.'

/** Shown when the selected conversation belongs to a different context — chatting is blocked. */
export const OTHER_VISIT_READONLY_MESSAGE =
    "This visit has ended. You can view this conversation's history but can't continue chatting."

export const OTHER_CONTEXT_READONLY_MESSAGE =
    "This conversation belongs to a different persona or context. You can view history but can't continue chatting here. Start a New Chat."

/** Composer placeholder when the selected conversation is from a different visit. */
export const OTHER_VISIT_COMPOSER_PLACEHOLDER = 'This visit has ended — history only.'

export const OTHER_CONTEXT_COMPOSER_PLACEHOLDER = 'Different persona/context — history only.'

export function getVisitIdRequiredMessage() {
    return VISIT_ID_REQUIRED_MESSAGE_SECURE
}

export function getVisitIdComposerPlaceholder() {
    return 'Sign in to load your visit, or add ?visitId=<uuid>…'
}

export function getStudentIdRequiredMessage() {
    return STUDENT_ID_REQUIRED_MESSAGE
}

export function getStudentIdComposerPlaceholder() {
    return 'Sign in with a student account to start…'
}

/**
 * @param {string|null|undefined} visitId
 * @returns {boolean}
 */
export function isPlaceholderVisitId(visitId) {
    if (visitId == null) return true
    return String(visitId).trim().toLowerCase() === DEFAULT_VISIT_ID
}

/**
 * @param {ImportMetaEnv} [env]
 * @returns {boolean}
 */
export function hasConfiguredVisitId(env = import.meta.env) {
    return !isPlaceholderVisitId(resolveVisitId(env))
}

/** Loose UUID check (matches Java {@code UUID.fromString} wire shape, including nil UUID). */
const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isValidVisitId(value) {
    return typeof value === 'string' && UUID_RE.test(value.trim())
}

/** Alias: chat context ids (visit or Identity user UUID) share the same UUID wire shape. */
export const isValidContextId = isValidVisitId

/**
 * @param {unknown} value
 * @returns {string|null} normalized UUID or null
 */
export function normalizeVisitId(value) {
    if (value == null) return null
    const s = String(value).trim()
    return isValidVisitId(s) ? s : null
}

export const normalizeContextId = normalizeVisitId

/**
 * @returns {string} persisted visit id or empty string
 */
export function getRuntimeVisitId() {
    try {
        const v = localStorage.getItem(STORAGE_KEY)?.trim()
        return normalizeVisitId(v) ?? ''
    } catch {
        return ''
    }
}

/**
 * @param {string|null|undefined} id UUID string; blank clears storage
 */
export function setRuntimeVisitId(id) {
    const normalized = normalizeVisitId(id)
    try {
        if (!normalized) {
            localStorage.removeItem(STORAGE_KEY)
        } else {
            localStorage.setItem(STORAGE_KEY, normalized)
        }
    } catch {
        // private mode / quota
    }
}

export function wipeLegacyRosterStudentId() {
    try {
        localStorage.removeItem(LEGACY_STUDENT_STORAGE_KEY)
    } catch {
        // private mode / quota
    }
}

/**
 * @returns {boolean} true when OTP check-eligibility matched STUDENT / STUDENT_EXISTS
 */
export function getStudentEligible() {
    try {
        return localStorage.getItem(STUDENT_ELIGIBLE_STORAGE_KEY) === 'true'
    } catch {
        return false
    }
}

/**
 * @param {boolean} eligible
 */
export function setStudentEligible(eligible) {
    try {
        if (eligible) {
            localStorage.setItem(STUDENT_ELIGIBLE_STORAGE_KEY, 'true')
        } else {
            localStorage.removeItem(STUDENT_ELIGIBLE_STORAGE_KEY)
            localStorage.removeItem(STUDENT_STORAGE_KEY)
        }
    } catch {
        // private mode / quota
    }
}

/**
 * @returns {string} persisted Identity user UUID or empty string
 */
export function getRuntimeStudentId() {
    wipeLegacyRosterStudentId()
    try {
        const v = localStorage.getItem(STUDENT_STORAGE_KEY)?.trim()
        return normalizeContextId(v) ?? ''
    } catch {
        return ''
    }
}

/**
 * @param {string|null|undefined} id Identity user UUID; blank clears storage
 */
export function setRuntimeStudentId(id) {
    wipeLegacyRosterStudentId()
    const normalized = normalizeContextId(id)
    try {
        if (!normalized) {
            localStorage.removeItem(STUDENT_STORAGE_KEY)
        } else {
            localStorage.setItem(STUDENT_STORAGE_KEY, normalized)
        }
    } catch {
        // private mode / quota
    }
}

/**
 * STUDENT persona needs OTP eligibility plus a persisted Identity UUID.
 *
 * @returns {boolean}
 */
export function hasConfiguredStudentId() {
    return getStudentEligible() && Boolean(getRuntimeStudentId())
}

/**
 * @param {ImportMetaEnv} [env]
 * @returns {string|null}
 */
function readQueryVisitId(env) {
    if (typeof window === 'undefined') return null
    try {
        const params = new URLSearchParams(window.location.search)
        for (const key of ['visitId', 'visit_id']) {
            const v = normalizeVisitId(params.get(key))
            if (v) return v
        }
    } catch {
        // ignore
    }
    return null
}

/**
 * @param {ImportMetaEnv} [env]
 * @returns {string|null}
 */
function readEnvVisitId(env = import.meta.env) {
    const raw = env?.VITE_DEFAULT_VISIT_ID
    const v = normalizeVisitId(raw)
    if (raw != null && String(raw).trim() !== '' && !v) {
        log.warn('VITE_DEFAULT_VISIT_ID is not a valid UUID — ignored', {raw})
    }
    return v
}

/**
 * Resolves the visit UUID used inside {@link buildVisitChatContext}.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {string}
 */
export function resolveVisitId(env = import.meta.env) {
    const fromQuery = readQueryVisitId(env)
    if (fromQuery) return fromQuery
    const stored = getRuntimeVisitId()
    if (stored) return stored
    const fromEnv = readEnvVisitId(env)
    if (fromEnv) return fromEnv
    return DEFAULT_VISIT_ID
}

/**
 * @param {ImportMetaEnv} [env]
 * @returns {{ schemaVersion: string, contextType: string, contextData: { id: string } }}
 */
export function buildVisitChatContext(env = import.meta.env) {
    const visitId = resolveVisitId(env)
    return {
        schemaVersion: CHAT_CONTEXT_SCHEMA_VERSION,
        contextType: CHAT_CONTEXT_TYPE_VISIT,
        contextData: {id: visitId},
    }
}

/**
 * @param {string} studentId
 * @returns {{ schemaVersion: string, contextType: string, contextData: { id: string } }}
 */
export function buildStudentChatContext(studentId) {
    const id = normalizeContextId(studentId)
    if (!id) {
        throw new Error('Student id is required for STUDENT chatContext')
    }
    return {
        schemaVersion: CHAT_CONTEXT_SCHEMA_VERSION,
        contextType: CHAT_CONTEXT_TYPE_STUDENT,
        contextData: {id},
    }
}

/**
 * Visit envelope for orchestration start. Prefer persona-aware
 * {@code getChatContextForStart} from {@code personaSession.js}.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {{ schemaVersion: string, contextType: string, contextData: { id: string } }}
 */
export function getVisitChatContextForStart(env = import.meta.env) {
    const fromQuery = readQueryVisitId(env)
    if (fromQuery) {
        setRuntimeVisitId(fromQuery)
    }
    return buildVisitChatContext(env)
}

/**
 * Client-side gate: true when a conversation is anchored to a VISIT other than the current one.
 *
 * @param {{ contextType?: string|null, contextTypeId?: string|null }|null|undefined} conversation
 * @param {ImportMetaEnv} [env]
 * @returns {boolean}
 */
export function isOtherVisitConversation(conversation, env = import.meta.env) {
    if (!conversation || conversation.contextType !== CHAT_CONTEXT_TYPE_VISIT) return false
    const conversationVisitId = normalizeVisitId(conversation.contextTypeId)
    if (!conversationVisitId) return false
    const currentVisitId = resolveVisitId(env)
    if (isPlaceholderVisitId(currentVisitId)) return false
    return conversationVisitId !== currentVisitId
}
