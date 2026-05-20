/**
 * @file Client-side breadcrumb derivation for menu navigation.
 * @module utils/breadcrumb
 *
 * The backend no longer emits `payload.breadcrumb`. The frontend tracks the
 * user's menu-card taps (parsed from their `selectionSignal`) as an ordered
 * `selectionChain` of `{level, name, id}` entries, and derives the breadcrumb
 * shown above each menu turn from that chain plus an agent-specific root crumb.
 */

const SELECTION_SIGNAL_RE =
    /^\[([a-z0-9_-]+)\]\s+Selected\s+(Category|Subcategory|Product|Item)\s+\(name:\s+(.+?)\)\s+\(id:\s+([^)]+)\)\s*$/i

/**
 * Parses a `selectionSignal` string emitted by the agent on menu items.
 * Returns `null` if the string is not a recognised signal.
 *
 * @param {unknown} signal
 * @returns {{ prefix: string, level: 'Category'|'Subcategory'|'Product'|'Item', name: string, id: string } | null}
 */
export function parseSelectionSignal(signal) {
    if (typeof signal !== 'string') return null
    const m = signal.trim().match(SELECTION_SIGNAL_RE)
    if (!m) return null
    const level = m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase()
    return { prefix: m[1], level, name: m[3].trim(), id: m[4].trim() }
}

const ROOT_LABEL_BY_HANDLER = {
    // Display labels emitted by the SSE `handledBy` field.
    'Visitor Experience Agent': 'Assistant',
    'Catering Agent': 'Menu',
    'IT Support Agent': 'IT Support',
    'Facilities Agent': 'Facilities & Maintenance',
    'Facilities & Maintenance Agent': 'Facilities & Maintenance',
    // RouteCategory enum strings emitted by persisted turns.
    VISITOR_EXPERIENCE: 'Assistant',
    CATERING: 'Menu',
    IT_SUPPORT: 'IT Support',
    FACILITIES_MAINTENANCE: 'Facilities & Maintenance',
    ERROR: 'Assistant',
    error: 'Assistant',
}

/**
 * @param {string|null|undefined} handledBy SSE `handledBy` display label or persisted `routeCategory` enum.
 * @returns {{ label: string, levelKey: string }}
 */
export function rootCrumbFor(handledBy) {
    const key = handledBy != null ? String(handledBy).trim() : ''
    const label = (key && ROOT_LABEL_BY_HANDLER[key]) || 'Assistant'
    return { label, levelKey: 'root' }
}

function isCateringHandler(handledBy) {
    return handledBy === 'Catering Agent' || handledBy === 'CATERING'
}

/**
 * Append/replace the user's latest selection into the chain.
 * - `Category`           → chain becomes `[Category]` (resets prior chain).
 * - `Subcategory`        → chain becomes `[parentCategory?, Subcategory]`.
 * - `Product` / `Item`   → chain unchanged (leaf — starts order/ticket path, no deeper menu).
 *
 * @param {Array<{level:string,name:string,id:string}>|null|undefined} chain
 * @param {{ level: string, name: string, id: string } | null} parsed Output of {@link parseSelectionSignal}.
 * @returns {Array<{level:string,name:string,id:string}>}
 */
export function updateChainOnSelection(chain, parsed) {
    const safe = Array.isArray(chain) ? chain : []
    if (!parsed) return safe
    if (parsed.level === 'Category') {
        return [{ level: 'Category', name: parsed.name, id: parsed.id }]
    }
    if (parsed.level === 'Subcategory') {
        const parent = safe.find((c) => c.level === 'Category') ?? null
        const entry = { level: 'Subcategory', name: parsed.name, id: parsed.id }
        return parent ? [parent, entry] : [entry]
    }
    return safe
}

function inferDisplayLevel(items, handledBy) {
    if (!Array.isArray(items) || items.length === 0) return null
    const first = items[0]
    if (first?.code != null) return 'Product' // only catering products have a code
    if (first?.categoryId != null) {
        return isCateringHandler(handledBy) ? 'Subcategory' : 'Item'
    }
    return isCateringHandler(handledBy) ? 'Category' : 'Subcategory'
}

/**
 * Reconcile the selection chain against the level of items just received from the agent.
 * Trims the chain to the number of expected ancestor entries; leaves a too-short chain
 * untouched (the breadcrumb will simply show fewer ancestors — acceptable degradation).
 *
 * @param {Array<{level:string,name:string,id:string}>} chain
 * @param {Array} items
 * @param {string|null|undefined} handledBy
 * @returns {Array<{level:string,name:string,id:string}>}
 */
export function reconcileChainWithResponse(chain, items, handledBy) {
    const safe = Array.isArray(chain) ? chain : []
    const level = inferDisplayLevel(items, handledBy)
    if (level == null) return safe
    const catering = isCateringHandler(handledBy)
    let expected
    if (catering) {
        expected = level === 'Category' ? 0 : level === 'Subcategory' ? 1 : 2
    } else {
        expected = level === 'Subcategory' ? 0 : 1
    }
    if (expected === 0) return []
    if (safe.length > expected) return safe.slice(0, expected)
    return safe
}

/**
 * Builds the breadcrumb to display for a menu response.
 *
 * @param {string|null|undefined} handledBy
 * @param {Array<{level:string,name:string,id:string}>} chain
 * @returns {Array<{ label: string, levelKey: string }>}
 */
export function deriveBreadcrumb(handledBy, chain) {
    const crumbs = [rootCrumbFor(handledBy)]
    const safe = Array.isArray(chain) ? chain : []
    for (const c of safe) {
        if (!c || !c.name || !c.id) continue
        const levelKey = c.level === 'Category' ? `cat/${c.id}` : `sub/${c.id}`
        crumbs.push({ label: c.name, levelKey })
    }
    return crumbs
}

/**
 * Walk a transcript chronologically and reconstruct the selection chain at the
 * end. Used when resuming a conversation: persisted user turns whose text is a
 * selectionSignal feed the chain so the breadcrumb on the next live turn is correct.
 *
 * @param {Array<{ role: string, text?: string }>} messages
 * @returns {Array<{level:string,name:string,id:string}>}
 */
export function rebuildChainFromMessages(messages) {
    let chain = []
    if (!Array.isArray(messages)) return chain
    for (const m of messages) {
        if (m?.role !== 'user' || typeof m.text !== 'string') continue
        const parsed = parseSelectionSignal(m.text)
        if (parsed) chain = updateChainOnSelection(chain, parsed)
    }
    return chain
}
