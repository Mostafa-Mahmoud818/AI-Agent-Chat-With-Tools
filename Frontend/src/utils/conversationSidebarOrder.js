/**
 * Sidebar ordering aligned with backend `ConversationRepository.findByClientForListing`:
 * `ORDER BY last_turn_at DESC NULLS LAST, updated_at DESC` (then stable tie-break on `created_at`).
 *
 * @param {string|null|undefined} iso ISO-8601 instant or undefined
 * @returns {number|null} epoch ms or null when missing/invalid
 */
function parseInstant(iso) {
    if (iso == null || iso === '') return null
    const t = new Date(iso).getTime()
    return Number.isNaN(t) ? null : t
}

/**
 * @param {object} a ConversationDto-like row
 * @param {object} b ConversationDto-like row
 * @returns {number}
 */
function compareSidebarConversations(a, b) {
    const aLt = parseInstant(a.lastTurnAt)
    const bLt = parseInstant(b.lastTurnAt)
    const aHas = aLt != null
    const bHas = bLt != null

    // Non-null lastTurnAt rows before null (PostgreSQL DESC NULLS LAST)
    if (aHas !== bHas) return aHas ? -1 : 1

    if (aHas && bHas && aLt !== bLt) return bLt - aLt

    const aUp = parseInstant(a.updatedAt) ?? 0
    const bUp = parseInstant(b.updatedAt) ?? 0
    if (aUp !== bUp) return bUp - aUp

    const aCr = parseInstant(a.createdAt) ?? 0
    const bCr = parseInstant(b.createdAt) ?? 0
    return bCr - aCr
}

/**
 * @param {object[]} rows ConversationDto rows from `getConversations().content`
 * @returns {object[]} new array sorted for sidebar display
 */
export function sortConversationsForSidebar(rows) {
    if (!Array.isArray(rows) || rows.length < 2) return rows ? [...rows] : []
    return [...rows].sort(compareSidebarConversations)
}

/**
 * Updates one row’s activity timestamps (matches a persisted turn) and re-sorts.
 * Used for real-time sidebar ordering without waiting for `GET /conversations`.
 *
 * @param {object[]} rows Current sidebar rows
 * @param {string} conversationId UUID string
 * @param {string} iso ISO-8601 instant (typically `new Date().toISOString()`)
 * @returns {object[]} New sorted array (copy)
 */
export function bumpConversationLastActivity(rows, conversationId, iso) {
    if (!Array.isArray(rows) || rows.length === 0) return rows ? [...rows] : []
    const cid = String(conversationId)
    const next = rows.map((c) => {
        if (String(c.id) !== cid) return c
        return {
            ...c,
            lastTurnAt: iso,
            updatedAt: iso,
        }
    })
    return sortConversationsForSidebar(next)
}
