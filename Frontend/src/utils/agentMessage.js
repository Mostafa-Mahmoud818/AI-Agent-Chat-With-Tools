/**
 * Parses agent JSON replies from backend (catering / structured agents) from raw SSE or persisted turn text.
 * 
 * The backend serializes agent responses as JSON with optional structured payloads.
 * This function handles both raw text and nested JSON structures.
 */
export function parseAgentMessage(raw) {
    if (raw == null || raw === '') {
        return { text: '', payload: null }
    }
    let text = raw
    let payload = null
    try {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
            if (parsed.replyType) {
                text = parsed.textString != null ? parsed.textString : raw
                if (parsed.replyType === 'json') {
                    payload = normalizePayload(parsed.payload)
                }
            } else if (parsed.textString != null || parsed.payload != null) {
                text = parsed.textString != null ? parsed.textString : raw
                payload = normalizePayload(parsed.payload)
            } else {
                payload = normalizePayload(parsed)
            }
        }
    } catch {
        // not JSON — use raw text as-is
    }
    return { text, payload }
}

function normalizePayload(payload) {
    if (payload == null) return null

    if (Array.isArray(payload)) {
        const menuitems = toMenuItems(payload)
        return menuitems.length > 0 ? { subtype: 'menu', menuitems } : null
    }

    if (typeof payload !== 'object') return null

    if (payload.subtype === 'menu' && Array.isArray(payload.menuitems)) {
        return { ...payload, menuitems: toMenuItems(payload.menuitems) }
    }

    if (Array.isArray(payload.menuitems)) {
        return { ...payload, subtype: 'menu', menuitems: toMenuItems(payload.menuitems) }
    }

    if (Array.isArray(payload.items)) {
        const menuitems = toMenuItems(payload.items)
        if (menuitems.length > 0) {
            return { ...payload, subtype: payload.subtype || 'menu', menuitems }
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
            }
        })
        .filter(Boolean)
}

/**
 * Maps API TurnDto[] (chronological order) to internal message objects for UI rendering.
 * 
 * Backend TurnDto fields mapped to message format:
 * - id: UUID → message.id (prefixed with turn-{id}-u/a)
 * - userInput: string → message.text
 * - createdAt: Instant → message.timestamp (ISO string, converted to Date)
 * - agentResponse: string|null → parsed and split into text + payload
 * - routeCategory: RouteCategory enum → message.handledBy (IT_SUPPORT, CATERING, ERROR)
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
