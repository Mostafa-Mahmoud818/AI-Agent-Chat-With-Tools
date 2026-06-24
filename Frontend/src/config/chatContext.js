/**
 * @file User-persona `chatContext` envelope for orchestration start.
 * @module config/chatContext
 *
 * Mirrors backend {@code ChatContext} + {@code VisitContextData}:
 * {@code { schemaVersion: "1.0", contextType: "VISIT", contextData: { id: "<uuid>" } } }.
 * Sent only on {@code POST .../orchestration/conversations/{id}/start}; follow-ups omit it.
 *
 * **visitId resolution (first match wins):**
 * 1. URL query {@code ?visitId=} or {@code ?visit_id=}
 * 2. {@code localStorage} ({@link STORAGE_KEY}) — set in the auth dialog
 * 3. {@code VITE_DEFAULT_VISIT_ID}
 * 4. {@link DEFAULT_VISIT_ID} — treated as unconfigured; orchestration start is blocked
 */

import {createLogger} from '../utils/logger.js'

const log = createLogger('chatContext')

export const CHAT_CONTEXT_SCHEMA_VERSION = '1.0'
export const CHAT_CONTEXT_TYPE_VISIT = 'VISIT'
export const STORAGE_KEY = 'ankabut.chat.visitId'

/** Sentinel when no visit is configured; not sent to orchestration start. */
export const DEFAULT_VISIT_ID = '00000000-0000-0000-0000-000000000000'

/** Shown when {@link hasConfiguredVisitId} is false (secure mode). */
export const VISIT_ID_REQUIRED_MESSAGE_SECURE =
    'No visit found for your account. Sign in again so the app can load your visit from the server, or use ?visitId= with a valid UUID.'

/** Shown when {@link hasConfiguredVisitId} is false (guest mode). */
export const VISIT_ID_REQUIRED_MESSAGE_GUEST =
    'Set a Visit ID below, use ?visitId=<uuid> in the URL, or configure VITE_DEFAULT_VISIT_ID before starting chat.'

/** Shown when the selected conversation belongs to a different (ended) visit — chatting is blocked. */
export const OTHER_VISIT_READONLY_MESSAGE =
    "This visit has ended. You can view this conversation's history but can't continue chatting."

/** Composer placeholder when the selected conversation is from a different (ended) visit. */
export const OTHER_VISIT_COMPOSER_PLACEHOLDER = 'This visit has ended — history only.'

/** @deprecated Use {@link getVisitIdRequiredMessage} */
export const VISIT_ID_REQUIRED_MESSAGE = VISIT_ID_REQUIRED_MESSAGE_SECURE

/**
 * @param {ImportMetaEnv} [env]
 * @param {boolean} [guestMode]
 * @returns {string}
 */
export function getVisitIdRequiredMessage(env = import.meta.env, guestMode = false) {
    return guestMode ? VISIT_ID_REQUIRED_MESSAGE_GUEST : VISIT_ID_REQUIRED_MESSAGE_SECURE
}

/**
 * Composer placeholder when visit id is not yet configured.
 *
 * @param {ImportMetaEnv} [env]
 * @param {boolean} [guestMode]
 * @returns {string}
 */
export function getVisitIdComposerPlaceholder(env = import.meta.env, guestMode = false) {
    if (guestMode) {
        return 'Set Visit ID in the bar above to start…'
    }
    return 'Sign in to load your visit, or add ?visitId=<uuid>…'
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
 * @returns {boolean} true when a non-placeholder visit id is available for orchestration start
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

/**
 * @param {unknown} value
 * @returns {string|null} normalized UUID or null
 */
export function normalizeVisitId(value) {
    if (value == null) return null
    const s = String(value).trim()
    return isValidVisitId(s) ? s : null
}

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
 * Wire payload for {@code ChattingOrchestrationStartRequest.chatContext}.
 * Persists a query-param visit id into localStorage when present.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {{ schemaVersion: string, contextType: string, contextData: { id: string } }}
 */
export function getChatContextForStart(env = import.meta.env) {
    const fromQuery = readQueryVisitId(env)
    if (fromQuery) {
        setRuntimeVisitId(fromQuery)
    }
    return buildVisitChatContext(env)
}

/**
 * Client-side gate: true when a conversation is anchored to a VISIT *other than* the current one,
 * so chatting must be blocked while history viewing stays allowed. Returns false for new chats,
 * non-VISIT conversations, conversations without a context id, when no current visit is configured,
 * or when the conversation's visit matches the current visit.
 *
 * Mirrors backend exposure: {@code ConversationDto.contextType} / {@code ConversationDto.contextTypeId}.
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
