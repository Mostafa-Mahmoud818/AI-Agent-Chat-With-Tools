/**
 * Parses agent JSON replies from backend (catering / IT / F&M agents) from raw SSE or persisted turn text.
 *
 * The backend serializes agent responses as JSON with optional structured payloads.
 * This function handles both raw text and nested JSON structures.
 *
 * - Catering (`ai-agent-catering`): replyType json + textString + payload (menu, order_confirmation, …).
 * - IT Support & Facilities & Maintenance: same catering-style menu shape (textString, replyType text|json,
 *   payload.subtype menu|none|ticket|error, menuitems, breadcrumb, order null, ticketId/ticketStatus).
 */
/** Prefer textContent (IT/F&M BPMN) then textString (catering BPMN). */
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

/** Structured reply kinds: agents emit replyType json for all card/menu/ticket payloads. */
function isStructuredAgentReply(replyType) {
    return replyType === 'json'
}

/**
 * Strips markdown code fences that some LLMs emit even when instructed not to.
 * Handles ```json ... ``` and ``` ... ``` wrappers, plus leading/trailing whitespace.
 */
function stripCodeFences(raw) {
    const trimmed = raw.trim()
    // ```json\n...\n``` or ```\n...\n```
    const fenceMatch = trimmed.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
    if (fenceMatch) return fenceMatch[1].trim()
    return trimmed
}

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

function toMenuItems(items) {
    if (!Array.isArray(items)) return []
    return items
        .map((item, idx) => {
            if (!item || typeof item !== 'object') return null
            const label = item.label ?? item.name ?? item.title ?? null
            if (!label) return null
            return {
                id: String(item.id ?? item.code ?? `item-${idx}`),
                label: String(label),
                description: item.description ?? item.summary ?? null,
                price: item.price ?? item.cost ?? null,
                code: item.code ?? null,
                categoryId: item.categoryId ?? null,
                status: item.status ?? null,
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
 * Maps API TurnDto[] (chronological order) to internal message objects for UI rendering.
 * 
 * Backend TurnDto fields mapped to message format:
 * - id: UUID → message.id (prefixed with turn-{id}-u/a)
 * - userInput: string → message.text
 * - createdAt: Instant → message.timestamp (ISO string, converted to Date)
 * - agentResponse: string|null → parsed and split into text + payload
 * - routeCategory: RouteCategory enum → message.handledBy (CATERING, IT_SUPPORT, FACILITIES_MAINTENANCE, ERROR)
 * - sessionId, turnNumber: metadata used for conversation structure
 * 
 * @param {Array} turns - TurnDto[] from backend paginated results
 * @returns {Array} messages - Internal message format: [{id, role, text, timestamp, handledBy, payload}]
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
