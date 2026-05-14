/**
 * @file LRU menu-level cache keyed by server session id and agent `breadcrumb.levelKey`.
 * @module utils/menuCache
 *
 * Clicking breadcrumb ancestors replays cached `payload` without a round-trip.
 * Bounded by {@link MENU_CACHE_LIMITS} (NFR-12 style cap). Cleared on session switch and
 * invalidation triggers (order confirmation, restart intent, session end per BR-14).
 */

const MAX_ENTRIES = 50
const MAX_BYTES = 1_000_000 // 1 MB
const RESTART_INTENT_RE = /\b(start over|restart|reset|new order|go back to the (start|beginning)|begin again)\b/i

/** sessionId -> Map<levelKey, { payload, bytes }>. Map preserves insertion order → used for LRU. */
const store = new Map()
let activeSessionId = null

function estimateBytes(payload) {
    try {
        return JSON.stringify(payload).length * 2 // rough UTF-16 estimate
    } catch {
        return 0
    }
}

function getSessionMap(sessionId) {
    if (!sessionId) return null
    let m = store.get(sessionId)
    if (!m) {
        m = new Map()
        store.set(sessionId, m)
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
 * Activates a session for cache reads/writes; evicts the previous session’s map (no cross-session reuse).
 * @param {string|null|undefined} sessionId Last turn’s `sessionId`, or `conversationId` until known.
 */
export function setActiveSession(sessionId) {
    if (activeSessionId && activeSessionId !== sessionId) {
        store.delete(activeSessionId)
    }
    activeSessionId = sessionId ?? null
}

/**
 * Stores a parsed menu `payload` for `levelKey` (e.g. `cat/uuid`). LRU bump on re-insert.
 * @param {string|null|undefined} sessionId
 * @param {string|null|undefined} levelKey From `payload.breadcrumb` / agent contract.
 * @param {object} payload Normalized menu payload (same shape as rendered in bubbles).
 */
export function cacheLevel(sessionId, levelKey, payload) {
    if (!sessionId || !levelKey || payload == null) return
    const sessionMap = getSessionMap(sessionId)
    // Re-insert to mark most-recently-used (Map preserves insertion order).
    sessionMap.delete(levelKey)
    sessionMap.set(levelKey, { payload, bytes: estimateBytes(payload) })
    evictUntilUnderCaps(sessionMap)
}

/**
 * Retrieves a menu payload by `levelKey`, promoting LRU order.
 * @param {string|null|undefined} sessionId
 * @param {string|null|undefined} levelKey
 * @returns {object|null}
 */
export function getCachedLevel(sessionId, levelKey) {
    if (!sessionId || !levelKey) return null
    const sessionMap = store.get(sessionId)
    if (!sessionMap) return null
    const entry = sessionMap.get(levelKey)
    if (!entry) return null
    sessionMap.delete(levelKey)
    sessionMap.set(levelKey, entry)
    return entry.payload
}

/** Drops all cached levels for one session id. */
export function invalidateSession(sessionId) {
    if (!sessionId) return
    store.delete(sessionId)
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
    activeSessionId = null
}

/**
 * Immutable snapshot of LRU caps (`MAX_ENTRIES`, `MAX_BYTES`).
 * @readonly
 */
export const MENU_CACHE_LIMITS = Object.freeze({ MAX_ENTRIES, MAX_BYTES })
