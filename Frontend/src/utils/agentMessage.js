/**
 * @file Parses agent JSON from persisted turns and live SSE, and maps `TurnDto` rows to UI messages.
 * @module utils/agentMessage
 *
 * Catering, IT, and F&amp;M agents share a catering-shaped envelope (`replyType`, `textString` or `textContent`,
 * `payload.subtype` menu | ticket | error | order_confirmation | none). This module normalizes fences,
 * flattened legacy shapes, breadcrumbs, and menu item fields (including optional `selectionSignal`).
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
                if (isStructuredAgentReply(parsed.replyType) && parsed.payload != null) {
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
 * @param {object[]|null|undefined} turns Chronological rows (oldest first), e.g. from {@link fetchAllConversationTurns};
 *     raw `getConversationTurns` returns newest-first and must be reversed before calling this.
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
