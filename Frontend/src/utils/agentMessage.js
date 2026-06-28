/**
 * @file Parses agent JSON from persisted turns and live SSE, and maps `TurnDto` rows to UI messages.
 * @module utils/agentMessage
 *
 * Catering, IT, and F&amp;M agents share a catering-shaped envelope (`replyType`, `textString` or `textContent`,
 * `payload.subtype` menu | ticket | error | order_confirmation | location | none). This module normalizes
 * fences, flattened legacy shapes, breadcrumbs, menu item fields (including optional `selectionSignal`),
 * and the Visitor Experience `location` navigation object.
 */
/**
 * Prefer `textContent` (IT/F&M BPMN) then `textString` (catering BPMN).
 * @param {object} parsed Parsed top-level agent JSON.
 * @param {string} fallback Raw string if both fields are whitespace-only.
 */
function primaryAssistantText(parsed, fallback) {
    if (parsed.textContent != null) {
        const s = String(parsed.textContent)
        // Explicit empty string is an intentional signal (e.g. error payload); whitespace-only falls back.
        if (s === '' || s.trim() !== '') return s
    }
    if (parsed.textString != null) {
        const s = String(parsed.textString)
        if (s === '' || s.trim() !== '') return s
    }
    return fallback
}

/** @param {string|null|undefined} replyType */
function isStructuredAgentReply(replyType) {
    return replyType === 'json'
}

/** Subtypes that carry a structured card and must be normalized regardless of `replyType`. */
const STRUCTURED_SUBTYPES = new Set(['menu', 'ticket', 'order_confirmation', 'indoor_navigation', 'outdoor_navigation', 'visits_query'])

/**
 * True when the payload declares a known structured subtype. Structured cards are canonically sent
 * with `replyType:"json"`, but detection stays defensive: a navigation reply carries a structured
 * `navigation` payload and a human `textString`, so a model slip to `replyType:"text"` must still
 * surface the card. We therefore do not rely on `replyType === "json"` alone.
 * @param {*} payload
 */
function hasStructuredSubtype(payload) {
    return payload != null && typeof payload === 'object' && STRUCTURED_SUBTYPES.has(payload.subtype)
}

/**
 * Strips markdown code fences that some LLMs emit even when instructed not to.
 * Handles ```json ... ``` and ``` ... ``` wrappers, plus leading/trailing whitespace.
 *
 * @param {string} raw
 * @returns {string}
 */
function stripCodeFences(raw) {
    const trimmed = raw.trim()
    // ```json\n...\n``` or ```\n...\n```
    const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
    if (fenceMatch) return fenceMatch[1].trim()
    return trimmed
}

/**
 * Parses a single agent response string: plain text, JSON envelope, or fenced JSON.
 *
 * @param {string|null|undefined} raw Persisted `TurnDto.agentResponse`, or SSE `text` field.
 * @returns {{ text: string, payload: object|null }} Display `text` plus structured `payload` when applicable
 *   (`subtype` menu, ticket, order_confirmation, error, etc.; `null` for plain-text-only turns).
 */
export function parseAgentMessage(raw) {
    if (raw == null || raw === '') {
        return { text: '', payload: null }
    }
    let text = raw
    let payload = null
    try {
        let parsed = JSON.parse(stripCodeFences(raw))
        // Defensive flatten-recovery: older IT/F&M prompts emitted payload fields at the top level
        // (e.g. payload="menu", menuitems:[...] instead of payload:{subtype:"menu", menuitems:[...]}).
        // Detect this by checking whether payload is a primitive string and top-level menuitems exists.
        if (
            parsed &&
            typeof parsed === 'object' &&
            typeof parsed.payload === 'string' &&
            Array.isArray(parsed.menuitems)
        ) {
            const { payload: subtype, menuitems, breadcrumb, order, ticketId, ticketStatus, ...rest } = parsed
            parsed = {
                ...rest,
                payload: {
                    subtype,
                    menuitems,
                    breadcrumb: breadcrumb ?? [],
                    order: order ?? null,
                    ticketId: ticketId ?? null,
                    ticketStatus: ticketStatus ?? null,
                },
            }
        }
        if (parsed && typeof parsed === 'object') {
            if (parsed.replyType) {
                text = primaryAssistantText(parsed, raw)
                if (parsed.payload != null && (isStructuredAgentReply(parsed.replyType) || hasStructuredSubtype(parsed.payload))) {
                    payload = normalizePayload(parsed.payload, parsed.replyType)
                }
            } else if (parsed.textString != null || parsed.textContent != null || parsed.payload != null) {
                text = primaryAssistantText(parsed, raw)
                payload = normalizePayload(parsed.payload, null)
            } else {
                payload = normalizePayload(parsed, null)
            }
        }
    } catch {
        // not JSON — use raw text as-is
    }
    return { text, payload }
}

/** @param {*} payload @param {string|null} [replyType] */
function normalizePayload(payload, replyType) {
    if (payload == null) return null

    if (Array.isArray(payload)) {
        const menuitems = toMenuItems(payload)
        return menuitems.length > 0 ? { subtype: 'menu', menuitems } : null
    }

    if (typeof payload !== 'object') return null

    // "none" means a plain text reply with no structured card — discard payload entirely.
    if (payload.subtype === 'none') return null

    // Preserve error subtype verbatim; frontend renders the fixed NFR-04 copy.
    if (payload.subtype === 'error') {
        return { ...payload, menuitems: [], order: null }
    }

    // Named subtypes with their own card UI — must come BEFORE the generic menuitems array checks
    // so that menuitems:[] doesn't accidentally promote them to subtype "menu".
    if (payload.subtype === 'order_confirmation') {
        return { ...payload }
    }

    // Ticket — preserve subtype.
    if (payload.subtype === 'ticket') {
        return { ...payload, subtype: 'ticket' }
    }

    // Navigation cards (Visitor Experience). The subtype encodes indoor vs outdoor — the client
    // reads it directly (no nested type field). Must come BEFORE the generic menuitems checks so
    // an empty menuitems:[] isn't promoted to subtype "menu".
    if (payload.subtype === 'indoor_navigation' || payload.subtype === 'outdoor_navigation') {
        const isOutdoor = payload.subtype === 'outdoor_navigation'
        return { ...payload, navigation: toNavigation(payload.navigation, isOutdoor), menuitems: [], order: null }
    }

    if (payload.subtype === 'visits_query') {
        return { ...payload, visits: toVisitsQuery(payload.visits), menuitems: [], order: null }
    }

    if (payload.subtype === 'menu' && Array.isArray(payload.menuitems)) {
        return { ...payload, menuitems: toMenuItems(payload.menuitems), breadcrumb: toBreadcrumb(payload.breadcrumb) }
    }

    if (Array.isArray(payload.menuitems)) {
        return { ...payload, subtype: 'menu', menuitems: toMenuItems(payload.menuitems), breadcrumb: toBreadcrumb(payload.breadcrumb) }
    }

    if (Array.isArray(payload.items)) {
        const menuitems = toMenuItems(payload.items)
        if (menuitems.length > 0) {
            return { ...payload, subtype: 'menu', menuitems }
        }
    }

    return payload
}

/**
 * Normalizes a visits_query payload's nested `visits` object for card rendering.
 * @param {*} raw
 * @returns {object|null}
 */
function toVisitsQuery(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const str = (v) => {
        if (v == null) return null
        const s = String(v).trim()
        return s === '' ? null : s
    }
    const items = Array.isArray(raw.items)
        ? raw.items
            .map((item) => {
                if (!item || typeof item !== 'object') return null
                const title = str(item.title)
                if (!title) return null
                return {
                    visitId: str(item.visitId),
                    title,
                    status: str(item.status),
                    startLocal: str(item.startLocal),
                    endLocal: str(item.endLocal),
                    timeDisplay: formatVisitTimeRange(item.startLocal, item.endLocal),
                    hostName: str(item.hostName),
                    resourceName: str(item.resourceName),
                    locationName: str(item.locationName),
                    floorName: str(item.floorName),
                }
            })
            .filter(Boolean)
        : []
    return {
        scope: str(raw.scope),
        defaultApplied: Boolean(raw.defaultApplied),
        timezone: str(raw.timezone),
        totalCount: typeof raw.totalCount === 'number' ? raw.totalCount : items.length,
        page: typeof raw.page === 'number' ? raw.page : 0,
        size: typeof raw.size === 'number' ? raw.size : items.length,
        items,
    }
}

/** @param {string|null|undefined} startLocal @param {string|null|undefined} endLocal */
function formatVisitTimeRange(startLocal, endLocal) {
    const start = parseLocalDateTime(startLocal)
    const end = parseLocalDateTime(endLocal)
    if (start && end) {
        const sameDay = start.toDateString() === end.toDateString()
        const dateFmt = { weekday: 'short', month: 'short', day: 'numeric' }
        const timeFmt = { hour: 'numeric', minute: '2-digit' }
        if (sameDay) {
            return `${start.toLocaleDateString(undefined, dateFmt)}, ${start.toLocaleTimeString(undefined, timeFmt)} – ${end.toLocaleTimeString(undefined, timeFmt)}`
        }
        return `${start.toLocaleString(undefined, { ...dateFmt, ...timeFmt })} – ${end.toLocaleString(undefined, { ...dateFmt, ...timeFmt })}`
    }
    if (start) return start.toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
    if (endLocal != null && String(endLocal).trim() !== '') return String(endLocal)
    if (startLocal != null && String(startLocal).trim() !== '') return String(startLocal)
    return null
}

/** @param {string|null|undefined} iso */
function parseLocalDateTime(iso) {
    if (iso == null || String(iso).trim() === '') return null
    const d = new Date(String(iso))
    return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Normalizes heterogeneous agent row shapes into clickable menu cards.
 * Keeps `selectionSignal` when present (backend-enriched line for classifiers).
 *
 * @param {unknown} items
 * @returns {Array<{ id: string, label: string, description?: *, price?: *, code?: *, categoryId?: *, status?: *, selectionSignal?: string }>}
 */
function toMenuItems(items) {
    if (!Array.isArray(items)) return []
    return items
        .map((item) => {
            if (!item || typeof item !== 'object') return null
            const labelSrc = item.label ?? item.name ?? item.title ?? null
            const id = item.id != null ? String(item.id).trim()
                : item.code != null ? String(item.code).trim() : ''
            if (!id) return null
            if (!labelSrc) return null
            const label = labelSrc != null && String(labelSrc).trim() !== ''
                ? String(labelSrc)
                : id
            return {
                id,
                label: String(label),
                description: item.description ?? item.summary ?? null,
                price: item.price ?? item.cost ?? null,
                code: item.code ?? null,
                categoryId: item.categoryId ?? null,
                status: item.status ?? null,
                ...(item.selectionSignal != null && typeof item.selectionSignal === 'string'
                    ? { selectionSignal: item.selectionSignal }
                    : {}),
            }
        })
        .filter(Boolean)
}

/**
 * Normalizes a navigation reply's `payload.navigation` object into the shared contract shape.
 * Indoor vs outdoor comes from the reply subtype (passed as `isOutdoor`), not a nested field.
 * All five fields are always present (null when absent); coordinates are coerced to finite numbers
 * and forced null for indoor (mirroring the backend tool, which returns coordinates only for outdoor).
 *
 * @param {*} raw
 * @param {boolean} isOutdoor whether the reply subtype is `outdoor_navigation`
 * @returns {{locationName: string|null, resourceId: string|null, resourceName: string|null, latitude: number|null, longitude: number|null}|null}
 */
function toNavigation(raw, isOutdoor) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const str = (v) => {
        if (v == null) return null
        const s = String(v).trim()
        return s === '' ? null : s
    }
    const num = (v) => {
        if (v == null || v === '') return null
        const n = Number(v)
        return Number.isFinite(n) ? n : null
    }
    return {
        locationName: str(raw.locationName),
        resourceId: str(raw.resourceId),
        resourceName: str(raw.resourceName),
        latitude: isOutdoor ? num(raw.latitude) : null,
        longitude: isOutdoor ? num(raw.longitude) : null,
    }
}

/** Normalizes `payload.breadcrumb` into a trimmed [{label, levelKey}] list; returns null on invalid shape. */
function toBreadcrumb(raw) {
    if (!Array.isArray(raw) || raw.length === 0) return null
    const crumbs = raw
        .map((c) => {
            if (!c || typeof c !== 'object') return null
            const label = c.label != null ? String(c.label).trim() : ''
            const levelKey = c.levelKey != null ? String(c.levelKey).trim() : ''
            if (!label || !levelKey) return null
            return { label, levelKey }
        })
        .filter(Boolean)
    return crumbs.length > 0 ? crumbs : null
}

/**
 * Maps chronological `TurnDto` rows to alternating user/assistant messages for the transcript.
 *
 * @param {object[]|null|undefined} turns Chronological rows (oldest first), e.g. from {@link fetchAllConversationTurns} or {@link getConversationTurns}.
 * @returns {Array<{ id: string, role: 'user'|'ai', text: string, displayText?: string|null, timestamp: Date, handledBy?: string|null, payload?: object|null }>}
 */
export function turnsToMessages(turns) {
    if (!turns?.length) return []
    const messages = []
    for (const t of turns) {
        // Add user message
        messages.push({
            id: `turn-${t.id}-u`,
            role: 'user',
            text: t.userInput,
            displayText: t.displayText ?? null,
            timestamp: t.createdAt ? new Date(t.createdAt) : new Date(),
            handledBy: null,
            payload: null,
        })
        
        // Add agent response if present
        const agentResponse = t.agentResponse
        if (agentResponse != null && String(agentResponse).trim() !== '') {
            const { text, payload } = parseAgentMessage(agentResponse)
            messages.push({
                id: `turn-${t.id}-a`,
                role: 'ai',
                text,
                timestamp: t.updatedAt ? new Date(t.updatedAt) : new Date(),
                handledBy: t.routeCategory ?? null, // Backend RouteCategory enum
                payload,
            })
        }
    }
    return messages
}
