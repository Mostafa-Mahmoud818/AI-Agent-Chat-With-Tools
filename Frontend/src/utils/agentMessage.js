/**
 * @file Parses agent JSON from persisted turns and live SSE, and maps `TurnDto` rows to UI messages.
 * @module utils/agentMessage
 *
 * Agents share one envelope: `replyType`, `textString`, `payload.subtype`
 * (`menu` | `ticket` | `order_confirmation` | `indoor_navigation` | `outdoor_navigation` |
 * `attachment_request` | `date_request` | `error` | `none`).
 * Card data lives in a nested object per subtype: `payload.order` (catering), `payload.ticket` (IT / F&amp;M / absence),
 * `payload.navigation` (Visitor Experience), `payload.dateConstraint` (absence date_request).
 * Legacy-only: `textContent` (old IT/F&amp;M), the flat `ticketId`/`ticketStatus`/`referenceCode` payload keys
 * (replaced by `payload.ticket` on 2026-07-27) and `visits_query` (removed backend flag) are still parsed for history.
 * This module normalizes fences, flattened legacy shapes, menu item fields (including optional `selectionSignal`),
 * ticket objects, and Visitor Experience navigation payloads.
 */
import {createLogger} from './logger.js'
import { isAttachmentMarkerUserInput, isMenuSelectionUserInput } from './menuSelection.js'

const log = createLogger('agentMessage')

/**
 * Prefer `textString` (current backend/prompt contract). Fall back to legacy `textContent` for old turns.
 * Never surface the raw JSON envelope when both fields are whitespace-only.
 * @param {object} parsed Parsed top-level agent JSON.
 * @param {string} _fallback Unused — kept for call-site compatibility; envelope must not be shown.
 */
function primaryAssistantText(parsed, _fallback) {
    if (parsed.textString != null) {
        const s = String(parsed.textString)
        // Explicit empty string is an intentional signal (e.g. error payload); whitespace-only falls back.
        if (s === '' || s.trim() !== '') return s
    }
    if (parsed.textContent != null) {
        const s = String(parsed.textContent)
        if (s === '' || s.trim() !== '') return s
    }
    log.warn('Agent JSON missing usable textString/textContent; suppressing raw envelope')
    return ''
}

/** @param {string|null|undefined} replyType */
function isStructuredAgentReply(replyType) {
    return replyType === 'json'
}

/** Subtypes that carry a structured card and must be normalized regardless of `replyType`. */
const STRUCTURED_SUBTYPES = new Set([
    'menu',
    'ticket',
    'order_confirmation',
    'indoor_navigation',
    'outdoor_navigation',
    'attachment_request',
    'date_request',
    'visits_query',
])

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
            const { payload: subtype, menuitems, order, ticket, ticketId, ticketStatus, referenceCode, ...rest } = parsed
            parsed = {
                ...rest,
                payload: {
                    subtype,
                    menuitems,
                    order: order ?? null,
                    ticket: ticket ?? null,
                    // Legacy flat ticket keys — folded into `payload.ticket` by normalizePayload.
                    ticketId: ticketId ?? null,
                    ticketStatus: ticketStatus ?? null,
                    referenceCode: referenceCode ?? null,
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

    // Absence attach control — no nested object; keep subtype for composer mode.
    if (payload.subtype === 'attachment_request') {
        return { ...payload, subtype: 'attachment_request', menuitems: [], order: null, ticket: null }
    }

    // Absence date picker — preserve dateConstraint { field, afterDate? }.
    if (payload.subtype === 'date_request') {
        return {
            ...payload,
            subtype: 'date_request',
            dateConstraint: toDateConstraint(payload.dateConstraint),
            menuitems: [],
            order: null,
            ticket: null,
        }
    }

    // Named subtypes with their own card UI — must come BEFORE the generic menuitems array checks
    // so that menuitems:[] doesn't accidentally promote them to subtype "menu".
    if (payload.subtype === 'order_confirmation') {
        return { ...payload }
    }

    // Ticket (IT / F&M) — normalize to the nested `ticket` object, mirroring catering's `order`.
    if (payload.subtype === 'ticket') {
        return { ...payload, subtype: 'ticket', ticket: toTicket(payload) }
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
        const {breadcrumb: _drop, ...rest} = payload
        return {...rest, menuitems: toMenuItems(payload.menuitems)}
    }

    // Unknown / missing subtype with menuitems — do NOT promote to menu UI (4.5).
    if (Array.isArray(payload.menuitems)) {
        log.warn('Ignoring menuitems on non-menu subtype', {subtype: payload.subtype})
        const {breadcrumb: _drop, menuitems: _m, ...rest} = payload
        return Object.keys(rest).length > 0 ? {...rest, menuitems: []} : null
    }

    if (Array.isArray(payload.items) && payload.subtype === 'menu') {
        const menuitems = toMenuItems(payload.items)
        if (menuitems.length > 0) {
            return { ...payload, subtype: 'menu', menuitems }
        }
    }

    if (Array.isArray(payload.items) && (payload.subtype == null || payload.subtype === '')) {
        // Legacy bare items array without subtype — treat as menu only when explicitly menu-shaped history.
        // Prefer plain text for unknown subtypes.
        log.warn('Ignoring items array without subtype:menu')
    }

    return payload
}

/**
 * Normalizes {@code payload.dateConstraint} for date_request replies.
 * @param {*} raw
 * @returns {{ field: string|null, afterDate: string|null }|null}
 */
function toDateConstraint(raw) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
    const field = raw.field != null ? String(raw.field).trim() : null
    const afterDate = raw.afterDate != null ? String(raw.afterDate).trim() : null
    if (!field && !afterDate) return null
    return {
        field: field || null,
        afterDate: afterDate || null,
    }
}

/**
 * Normalizes a legacy `visits_query` payload's nested `visits` object for card rendering.
 * Current VE agents emit text-only listings (`subtype:"none"`); this path remains for old history turns.
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
                // Compact tool shape (`MyVisitsToolResponseDto.Item`) uses `name` / `period` / `whenLocal`.
                // Legacy visits_query cards used `title` / `status` / `startLocal`+`endLocal`.
                const title = str(item.title) ?? str(item.name)
                if (!title) return null
                return {
                    visitId: str(item.visitId),
                    title,
                    status: str(item.status) ?? str(item.period),
                    startLocal: str(item.startLocal),
                    endLocal: str(item.endLocal),
                    timeDisplay: str(item.whenLocal) ?? formatVisitTimeRange(item.startLocal, item.endLocal),
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
        windowPrevious: typeof raw.windowPrevious === 'number' ? raw.windowPrevious : null,
        windowUpcoming: typeof raw.windowUpcoming === 'number' ? raw.windowUpcoming : null,
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
 * Normalizes a `subtype:"ticket"` payload into the nested `ticket` object the card renders,
 * mirroring catering's `payload.order`.
 *
 * Current contract (backend 2026-07-27+): `payload.ticket = {id, referenceCode, status, createdAt}`.
 * Legacy: turns persisted before that date carried the three flat payload keys
 * (`ticketId` / `ticketStatus` / `referenceCode`) and no nested object — history must still render,
 * so those are folded into the same shape here. This is the single place that knows about the old
 * layout; `TicketCard` reads `payload.ticket` only.
 *
 * @param {object} payload the `subtype:"ticket"` payload
 * @returns {{id: string|null, referenceCode: string|null, status: string|null, createdAt: string|null}|null}
 *   `null` when no ticket data is present at all (a malformed card the backend also flags via
 *   `chatting.agent.ticket_contract_violation`).
 */
function toTicket(payload) {
    const nested = payload.ticket
    const hasNested = nested != null && typeof nested === 'object' && !Array.isArray(nested)
    const src = hasNested
        ? { id: nested.id, referenceCode: nested.referenceCode, status: nested.status, createdAt: nested.createdAt }
        : { id: payload.ticketId, referenceCode: payload.referenceCode, status: payload.ticketStatus, createdAt: payload.createdAt }

    const str = (v) => {
        if (v == null) return null
        const s = String(v).trim()
        return s === '' ? null : s
    }
    const ticket = {
        id: str(src.id),
        referenceCode: str(src.referenceCode),
        status: str(src.status),
        createdAt: str(src.createdAt),
    }
    return Object.values(ticket).some((v) => v !== null) ? ticket : null
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

/**
 * Maps chronological `TurnDto` rows to alternating user/assistant messages for the transcript.
 *
 * @param {object[]|null|undefined} turns Chronological rows (oldest first), e.g. from {@link fetchAllConversationTurns} or {@link getConversationTurns}.
 * @returns {Array<{ id: string, role: 'user'|'ai', system?: boolean, text: string, displayText?: string|null, timestamp: Date, handledBy?: string|null, payload?: object|null }>}
 */
export function turnsToMessages(turns) {
    if (!turns?.length) return []
    const messages = []
    for (const t of turns) {
        // Structural discriminator: `turnKind` is the authoritative backend signal (SYSTEM = injected,
        // no user message). `userInput == null` is only a legacy fallback for rows persisted before
        // turnKind was exposed on the API. NOTE: this is a TURN-level (structural) decision — it governs
        // whether a user bubble exists and how the row is laid out. It is intentionally independent of the
        // response `payload.subtype`, which is a CONTENT-level decision (which card to render).
        const isSystemTurn = t.turnKind === 'SYSTEM' || t.userInput == null
        if (!isSystemTurn) {
            // displayText is meaningful for menu-card clicks and attachment markers (short label).
            // Free-typed turns must show userInput — ignore any stale displayText left on the row.
            const trustDisplayText =
                isMenuSelectionUserInput(t.userInput) || isAttachmentMarkerUserInput(t.userInput)
            const displayText = trustDisplayText ? (t.displayText ?? null) : null
            messages.push({
                id: `turn-${t.id}-u`,
                role: 'user',
                text: t.userInput,
                displayText,
                timestamp: t.createdAt ? new Date(t.createdAt) : new Date(),
                handledBy: null,
                payload: null,
            })
        }

        // Add agent response if present
        const agentResponse = t.agentResponse
        if (agentResponse != null && String(agentResponse).trim() !== '') {
            const { text, payload } = parseAgentMessage(agentResponse)
            messages.push({
                id: `turn-${t.id}-a`,
                role: 'ai',
                system: isSystemTurn, // turnKind-derived; drives system-notification layout (not the card)
                text,
                timestamp: t.updatedAt ? new Date(t.updatedAt) : new Date(),
                handledBy: t.routeCategory ?? null, // Backend RouteCategory enum
                payload,
            })
        }
    }
    return messages
}
