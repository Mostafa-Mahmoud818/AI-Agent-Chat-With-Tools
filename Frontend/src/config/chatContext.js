/**
 * @file User-persona `chatContext` envelope for orchestration start.
 * @module config/chatContext
 *
 * Mirrors backend {@code ChatContext} + {@code VisitContextData}:
 * {@code { schemaVersion: "1.0", contextType: "VISIT", contextData: { visitId: "<uuid>" } } }.
 * Sent only on {@code POST .../orchestration/conversations/{id}/start}; follow-ups omit it.
 *
 * **visitId resolution (first match wins):**
 * 1. URL query {@code ?visitId=} or {@code ?visit_id=}
 * 2. {@code localStorage} ({@link STORAGE_KEY}) — set in the auth dialog
 * 3. {@code VITE_DEFAULT_VISIT_ID}
 * 4. All-zero UUID placeholder (Phase-1 backends may ignore visitId)
 */

import { createLogger } from '../utils/logger.js'

const log = createLogger('chatContext')

export const CHAT_CONTEXT_SCHEMA_VERSION = '1.0'
export const CHAT_CONTEXT_TYPE_VISIT = 'VISIT'
export const STORAGE_KEY = 'ankabut.chat.visitId'

/** Phase-1 fallback when no visit is configured. */
export const DEFAULT_VISIT_ID = '00000000-0000-0000-0000-000000000000'

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
        log.warn('VITE_DEFAULT_VISIT_ID is not a valid UUID — ignored', { raw })
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
 * @returns {{ schemaVersion: string, contextType: string, contextData: { visitId: string } }}
 */
export function buildVisitChatContext(env = import.meta.env) {
    const visitId = resolveVisitId(env)
    return {
        schemaVersion: CHAT_CONTEXT_SCHEMA_VERSION,
        contextType: CHAT_CONTEXT_TYPE_VISIT,
        contextData: { visitId },
    }
}

/**
 * Wire payload for {@code ChattingOrchestrationStartRequest.chatContext}.
 * Persists a query-param visit id into localStorage when present.
 *
 * @param {ImportMetaEnv} [env]
 * @returns {{ schemaVersion: string, contextType: string, contextData: { visitId: string } }}
 */
export function getChatContextForStart(env = import.meta.env) {
    const fromQuery = readQueryVisitId(env)
    if (fromQuery) {
        setRuntimeVisitId(fromQuery)
    }
    return buildVisitChatContext(env)
}
