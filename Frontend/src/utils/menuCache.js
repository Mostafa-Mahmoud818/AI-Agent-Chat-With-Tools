/**
 * In-memory, per-session LRU cache for catering menu levels.
 *
 * Keys levels by `levelKey` (e.g. "root", "cat/<id>", "sub/<id>"), emitted by the agent
 * in `payload.breadcrumb`. Used so clicking a breadcrumb ancestor replays the cached
 * menu in-place (no backend round-trip) while preserving strict forward drill-down
 * via fresh agent calls when the user keeps navigating downward.
 *
 * BRD constraints:
 *   - NFR-12: capped at MAX_ENTRIES levels OR MAX_BYTES — whichever hits first (LRU eviction).
 *   - BR-14 / design: invalidated on (a) order_confirmation, (b) restart intent, (c) session end.
 *   - MUST NOT survive across sessions — the store is keyed by sessionId and cleared on session change.
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

/** Switch the active session — invalidates the previous session's cache per BRD (no cross-session survival). */
export function setActiveSession(sessionId) {
    if (activeSessionId && activeSessionId !== sessionId) {
        store.delete(activeSessionId)
    }
    activeSessionId = sessionId ?? null
}

/** Store a level keyed by the agent-emitted levelKey. No-op if key or payload is missing. */
export function cacheLevel(sessionId, levelKey, payload) {
    if (!sessionId || !levelKey || payload == null) return
    const sessionMap = getSessionMap(sessionId)
    // Re-insert to mark most-recently-used (Map preserves insertion order).
    sessionMap.delete(levelKey)
    sessionMap.set(levelKey, { payload, bytes: estimateBytes(payload) })
    evictUntilUnderCaps(sessionMap)
}

/** Retrieve a cached level; touching it promotes it to most-recently-used. Returns null on miss. */
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

/** Drop the entire cache for a session — call on order_confirmation, restart intent, or session end. */
export function invalidateSession(sessionId) {
    if (!sessionId) return
    store.delete(sessionId)
}

/** Heuristic check for user-typed restart intent (BRD BR-14 invalidation trigger). */
export function isRestartIntent(text) {
    if (!text || typeof text !== 'string') return false
    return RESTART_INTENT_RE.test(text)
}

/** Test-only: wipe everything (used by unit tests). */
export function __resetMenuCacheForTests() {
    store.clear()
    activeSessionId = null
}

export const MENU_CACHE_LIMITS = Object.freeze({ MAX_ENTRIES, MAX_BYTES })
