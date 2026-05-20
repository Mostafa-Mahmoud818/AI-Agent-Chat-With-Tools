/**
 * @file LRU menu-level cache keyed by conversation id and agent `breadcrumb.levelKey`.
 * @module utils/menuCache
 *
 * {@code ConversationTurnDto} does not expose server {@code sessionId}; cache scope is the
 * conversation UUID (same id used for SSE and orchestration correlation).
 *
 * Clicking breadcrumb ancestors replays cached `payload` without a round-trip.
 * Bounded by {@link MENU_CACHE_LIMITS} (NFR-12 style cap). Cleared on conversation switch and
 * invalidation triggers (order confirmation, restart intent, session end per BR-14).
 */

const MAX_ENTRIES = 50
const MAX_BYTES = 1_000_000 // 1 MB
const RESTART_INTENT_RE = /\b(start over|restart|reset|new order|go back to the (start|beginning)|begin again)\b/i

/** conversationId -> Map<levelKey, { payload, bytes }>. Map preserves insertion order → used for LRU. */
const store = new Map()
let activeConversationId = null

function estimateBytes(payload) {
    try {
        return JSON.stringify(payload).length * 2 // rough UTF-16 estimate
    } catch {
        return 0
    }
}

function getConversationMap(conversationId) {
    if (!conversationId) return null
    let m = store.get(conversationId)
    if (!m) {
        m = new Map()
        store.set(conversationId, m)
    }
    return m
}

function totalBytes(sessionMap) {
    let sum = 0
    for (const { bytes } of sessionMap.values()) sum += bytes
    return sum
}

function evictUntilUnderCaps(sessionMap) {
    while (sessionMap.size > MAX_ENTRIES || totalBytes(sessionMap) > MAX_BYTES) {
        const oldestKey = sessionMap.keys().next().value
        if (oldestKey == null) break
        sessionMap.delete(oldestKey)
    }
}

/**
 * Activates a conversation for cache reads/writes; evicts the previous conversation’s map.
 * @param {string|null|undefined} conversationId Conversation UUID string.
 */
export function setActiveConversation(conversationId) {
    if (activeConversationId && activeConversationId !== conversationId) {
        store.delete(activeConversationId)
    }
    activeConversationId = conversationId ?? null
}

/** @deprecated Use {@link setActiveConversation}. */
export function setActiveSession(conversationId) {
    setActiveConversation(conversationId)
}

/**
 * Stores a parsed menu `payload` for `levelKey` (e.g. `cat/uuid`). LRU bump on re-insert.
 * @param {string|null|undefined} conversationId
 * @param {string|null|undefined} levelKey From `payload.breadcrumb` / agent contract.
 * @param {object} payload Normalized menu payload (same shape as rendered in bubbles).
 */
export function cacheLevel(conversationId, levelKey, payload) {
    if (!conversationId || !levelKey || payload == null) return
    const conversationMap = getConversationMap(conversationId)
    conversationMap.delete(levelKey)
    conversationMap.set(levelKey, { payload, bytes: estimateBytes(payload) })
    evictUntilUnderCaps(conversationMap)
}

/**
 * Retrieves a menu payload by `levelKey`, promoting LRU order.
 * @param {string|null|undefined} conversationId
 * @param {string|null|undefined} levelKey
 * @returns {object|null}
 */
export function getCachedLevel(conversationId, levelKey) {
    if (!conversationId || !levelKey) return null
    const conversationMap = store.get(conversationId)
    if (!conversationMap) return null
    const entry = conversationMap.get(levelKey)
    if (!entry) return null
    conversationMap.delete(levelKey)
    conversationMap.set(levelKey, entry)
    return entry.payload
}

/** Drops all cached levels for one conversation id. */
export function invalidateSession(conversationId) {
    if (!conversationId) return
    store.delete(conversationId)
}

/**
 * Heuristic for user-typed “start over” style phrases (cache invalidation trigger).
 * @param {string|null|undefined} text
 * @returns {boolean}
 */
export function isRestartIntent(text) {
    if (!text || typeof text !== 'string') return false
    return RESTART_INTENT_RE.test(text)
}

/** @returns {void} Vitest-only full reset. */
export function __resetMenuCacheForTests() {
    store.clear()
    activeConversationId = null
}

/**
 * Immutable snapshot of LRU caps (`MAX_ENTRIES`, `MAX_BYTES`).
 * @readonly
 */
export const MENU_CACHE_LIMITS = Object.freeze({ MAX_ENTRIES, MAX_BYTES })
