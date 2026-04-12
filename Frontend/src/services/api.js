/**
 * Ankabut DXP Chatting API — dual-mode (guest cookie + JWT secure).
 *
 * ════════════════════════════════════════════════════════════════════════════
 * Backend Service: Modulith Service (ankabut-dxp-modulith-service) on port 8085
 * API Base: /api/v1/public/chatting (guest) or /api/v1/secure/chatting (authenticated)
 * Database: PostgreSQL with schema dxp-chatting
 * Orchestration: Camunda 8 (Zeebe) for agentic workflows
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Guest mode  → /api/v1/public/chatting/*  (clientId via ankabut_guest_id cookie)
 * Secure mode → /api/v1/secure/chatting/*  (JWT via Authorization header)
 *
 * Data Types and Enums:
 * - SessionStatus: ACTIVE | TIMED_OUT | ENDED | ERROR
 * - RouteCategory: IT_SUPPORT | CATERING | ERROR
 * - AgentResponseStatus (wire format): ready | processing | error | expired
 */

import { createLogger } from '../utils/logger.js'

const log = createLogger('api')

const API_ORIGIN = (import.meta.env.VITE_API_ORIGIN || '').replace(/\/$/, '')
const PATH_PUBLIC = '/api/v1/public/chatting'
const PATH_SECURE = '/api/v1/secure/chatting'
const GUEST_COOKIE_NAME = 'ankabut_guest_id'
const JWT_STORAGE_KEY = 'ankabut_jwt'
const REQUEST_TIMEOUT_MS = 15_000

// ── Auth helpers ────────────────────────────────────────────────────

function getJwtToken() {
    try {
        return localStorage.getItem(JWT_STORAGE_KEY) || null
    } catch {
        return null
    }
}

export function setAuthToken(token) {
    localStorage.setItem(JWT_STORAGE_KEY, token)
}

export function clearAuthToken() {
    localStorage.removeItem(JWT_STORAGE_KEY)
}

export function isSecureMode() {
    return !!getJwtToken()
}

function getApiBase() {
    const base = isSecureMode() ? PATH_SECURE : PATH_PUBLIC
    return `${API_ORIGIN}${base}`
}

// ── Guest cookie helpers ────────────────────────────────────────────

function getCookie(name) {
    const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
    return match ? decodeURIComponent(match[1]) : null
}

function setCookie(name, value, days = 365) {
    const expires = new Date(Date.now() + days * 864e5).toUTCString()
    document.cookie = `${name}=${encodeURIComponent(value)}; expires=${expires}; path=/; SameSite=Lax`
}

function getOrCreateGuestId() {
    let id = getCookie(GUEST_COOKIE_NAME)
    if (!id) {
        id = crypto.randomUUID()
        setCookie(GUEST_COOKIE_NAME, id)
    }
    return id
}

/**
 * Returns `?clientId=X` for guest mode, empty string for secure mode.
 * If `existingQuery` is true, uses `&clientId=X` instead.
 */
function clientIdParam(existingQuery = false) {
    if (isSecureMode()) return ''
    const id = getOrCreateGuestId()
    return `${existingQuery ? '&' : '?'}clientId=${encodeURIComponent(id)}`
}

// ── Error handling ──────────────────────────────────────────────────

class ApiError extends Error {
    constructor(status, errorCode, message) {
        super(message)
        this.status = status
        this.errorCode = errorCode
    }
}

async function handleResponse(res) {
    if (res.ok) return res

    let errorCode = 'unknown'
    let message = `Request failed with status ${res.status}`

    const raw = await res.text()
    try {
        const body = raw ? JSON.parse(raw) : {}
        // Ankabut ApiResponse: { success, message, errors }
        if (body.message) {
            message = body.message
        } else if (body.error && body.path) {
            // Spring Boot default error JSON
            message = `${body.error} — ${body.path}`
        }
        if (body.errors?.length) {
            const first = body.errors[0]
            errorCode = first.code || first.field || errorCode
            if (first.message && !body.message) {
                message = first.message
            }
        }
        if (res.status === 410) errorCode = 'session_expired'
        if (res.status === 409) errorCode = 'conflict'
    } catch {
        if (raw?.trim()) {
            log.warn('Non-JSON error body (first 400 chars)', raw.slice(0, 400))
        }
    }

    log.warn('HTTP error', { status: res.status, errorCode, message })
    throw new ApiError(res.status, errorCode, message)
}

/**
 * Unwraps Ankabut's `ApiResponse<T>` envelope → returns `data`.
 */
async function unwrapResponse(res) {
    const json = await res.json()
    if (json.success === false) {
        throw new ApiError(res.status, 'api_error', json.message || 'Request failed')
    }
    return json.data
}

// ── HTTP helpers ────────────────────────────────────────────────────

const JSON_HEADERS = { 'Content-Type': 'application/json' }

function authHeaders() {
    const token = getJwtToken()
    if (token) {
        return { ...JSON_HEADERS, Authorization: `Bearer ${token}` }
    }
    return { ...JSON_HEADERS }
}

function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    return fetch(url, { ...options, signal: controller.signal })
        .catch(err => {
            if (err.name === 'AbortError') {
                log.warn('Request timeout', url)
                throw new ApiError(0, 'timeout', 'Request timed out. Please check your connection.')
            }
            log.error('Network failure', url, err)
            throw new ApiError(0, 'network_error', 'Network error. Is the backend running?')
        })
        .finally(() => clearTimeout(timer))
}

async function get(url) {
    log.debug('GET', url)
    const res = await fetchWithTimeout(url, {
        method: 'GET',
        headers: authHeaders(),
    })
    log.debug('GET response', url, res.status)
    return handleResponse(res)
}

async function post(url, body) {
    log.debug('POST', url)
    const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(body),
    })
    log.debug('POST response', url, res.status)
    return handleResponse(res)
}

// ── API functions ───────────────────────────────────────────────────

/**
 * Fetches paginated list of conversations for the current client (guest or user).
 * 
 * Backend: GET /api/v1/public(or /secure)/chatting/conversations
 * Response: PagedResponse<ConversationDto>
 * 
 * @param {{ page?: number, size?: number }} opts - Pagination params (default: page=0, size=50)
 * @returns {Promise<{ content: ConversationDto[], page: number, size: number, last: boolean }>}
 */
export async function getConversations({ page = 0, size = 50 } = {}) {
    const base = getApiBase()
    const qp = new URLSearchParams({ page: String(page), size: String(size) })
    if (!isSecureMode()) {
        qp.set('clientId', getOrCreateGuestId())
    }
    const res = await get(`${base}/conversations?${qp}`)
    return unwrapResponse(res)
}

/**
 * Fetches TurnDto[] for a conversation (contains user inputs + agent responses).
 * 
 * Backend: GET /api/v1/public(or /secure)/chatting/conversations/{id}/turns
 * Turns include: id, sessionId, turnNumber, userInput, routeCategory, agentResponse, createdAt, updatedAt
 * 
 * @param {string} conversationId - UUID of the conversation
 * @param {{ page?: number, size?: number }} opts - Pagination (default: page=0, size=200)
 * @returns {Promise<{ content: TurnDto[], page: number, last: boolean }>}
 */
export async function getConversationTurns(conversationId, { page = 0, size = 200 } = {}) {
    const base = getApiBase()
    const qp = new URLSearchParams({ page: String(page), size: String(size) })
    const res = await get(`${base}/conversations/${conversationId}/turns?${qp}${clientIdParam(true)}`)
    return unwrapResponse(res)
}

/** Loads all pages of turns for a conversation (demo / moderate history sizes). */
export async function fetchAllConversationTurns(conversationId, pageSize = 200) {
    const all = []
    let page = 0
    while (true) {
        const data = await getConversationTurns(conversationId, { page, size: pageSize })
        const chunk = data.content ?? []
        all.push(...chunk)
        if (data.last === true || chunk.length === 0) break
        page += 1
    }
    return all
}

/**
 * @param {string} conversationId
 * @param {{ page?: number, size?: number }} opts
 */
export async function getSessionsForConversation(conversationId, { page = 0, size = 50 } = {}) {
    const base = getApiBase()
    const qp = new URLSearchParams({ page: String(page), size: String(size) })
    const res = await get(`${base}/conversations/${conversationId}/sessions?${qp}${clientIdParam(true)}`)
    return unwrapResponse(res)
}

/**
 * @param {string} conversationId
 * @param {string | null} summary
 */
export async function createSessionInConversation(conversationId, summary = null) {
    const base = getApiBase()
    let res
    if (isSecureMode()) {
        res = await post(`${base}/conversations/${conversationId}/sessions`, { summary })
    } else {
        const guestId = getOrCreateGuestId()
        res = await post(`${base}/conversations/${conversationId}/sessions`, {
            clientId: guestId,
            req: { summary },
        })
    }
    return unwrapResponse(res)
}

/**
 * Creates a new conversation with an initial session.
 * 
 * Backend: POST /api/v1/public(or /secure)/chatting/conversations
 * Request: { initialTitle?, initialSummary? } (wrapped with clientId in guest mode)
 * Response: SessionDto (includes conversationId and sessionId)
 * 
 * @param {string} inputText - User's initial message (truncated to 50 chars for title)
 * @returns {Promise<{ conversationId: UUID, sessionId: UUID }>}
 */
export async function createConversation(inputText) {
    const base = getApiBase()
    const title = inputText.length > 50 ? inputText.substring(0, 50) + '…' : inputText

    let res
    if (isSecureMode()) {
        res = await post(`${base}/conversations`, { initialTitle: title })
    } else {
        const guestId = getOrCreateGuestId()
        res = await post(`${base}/conversations`, { clientId: guestId, req: { initialTitle: title } })
    }

    // Response is ApiResponse<SessionDto>
    const session = await unwrapResponse(res)
    log.info('Conversation created', {
        conversationId: session.conversationId,
        sessionId: session.id,
        secure: isSecureMode(),
    })
    return {
        conversationId: session.conversationId,
        sessionId: session.id,
    }
}

/**
 * Starts Camunda 8 orchestration process for a session.
 * 
 * Backend: POST /api/v1/public(or /secure)/chatting/orchestration/sessions/{id}/start
 * Request: { inputText: string, previousSessionId?: UUID }
 * Response: { sessionId: UUID, processInstanceKey: bigint }
 * 
 * This initiates the agentic workflow that classifies the user input and routes
 * to the appropriate handler (IT_SUPPORT, CATERING, etc.)
 * 
 * @param {string} sessionId - UUID of session to activate
 * @param {string} inputText - User message to start orchestration with
 * @param {string|null} previousSessionId - Optional previous session for context
 * @returns {Promise<{ sessionId: UUID, processInstanceKey: bigint }>}
 */
export async function startOrchestration(sessionId, inputText, previousSessionId = null) {
    const base = getApiBase()
    const qp = clientIdParam()
    const body = { inputText }
    if (previousSessionId) body.previousSessionId = previousSessionId

    const res = await post(`${base}/orchestration/sessions/${sessionId}/start${qp}`, body)
    const data = await unwrapResponse(res)
    log.info('Orchestration started', { sessionId, processInstanceKey: data?.processInstanceKey })
    return data
}

/**
 * Sends a follow-up user message to an active orchestration process.
 * 
 * Backend: POST /api/v1/public(or /secure)/chatting/orchestration/sessions/{id}/user-messages
 * Request: { followUpInput: string }
 * Response: void (202 Accepted)
 * 
 * @param {string} sessionId - UUID of the active session
 * @param {string} followUpInput - Follow-up message text
 */
export async function sendReply(sessionId, followUpInput) {
    const base = getApiBase()
    const qp = clientIdParam()
    log.info('Sending follow-up', { sessionId, chars: followUpInput?.length ?? 0 })
    await post(`${base}/orchestration/sessions/${sessionId}/user-messages${qp}`, { followUpInput })
}

/**
 * Opens a Server-Sent Events stream for live agent response updates.
 * 
 * Backend: GET /api/v1/public(or /secure)/chatting/orchestration/sessions/{id}/assistant-round/stream
 * SSE Event Format: { status: 'ready'|'processing'|'error'|'expired', message: string, handledBy?: string }
 * 
 * Statuses:
 * - processing: Agent is thinking
 * - ready: Agent response complete (includes message text)
 * - error: Error occurred (message contains error detail)
 * - expired: Session timed out
 * 
 * In guest mode: uses native EventSource (no auth header).
 * In secure mode: uses fetch-based SSE with Authorization header (EventSource doesn't support headers).
 *
 * @param {string} sessionId - UUID of the session to stream from
 * @returns {EventSource-like object} with onmessage, onerror, close(), readyState
 */
export function createResponseStream(sessionId) {
    const base = getApiBase()

    if (!isSecureMode()) {
        // Guest mode: native EventSource
        const qp = clientIdParam()
        const streamUrl = `${base}/orchestration/sessions/${sessionId}/assistant-round/stream${qp}`
        log.info('SSE open (guest EventSource)', { sessionId })
        return wrapNativeEventSource(new EventSource(streamUrl))
    }

    // Secure mode: fetch-based SSE with Authorization header
    const streamUrl = `${base}/orchestration/sessions/${sessionId}/assistant-round/stream`
    log.info('SSE open (secure fetch)', { sessionId })
    return createFetchEventSource(streamUrl)
}

/**
 * Fetch-based SSE for secure mode (Authorization header support).
 * Returns an EventSource-like object: { onmessage, onerror, close(), readyState }.
 */
function createFetchEventSource(url) {
    const controller = new AbortController()
    const listeners = new Map([['error', new Set()]])
    const emitter = {
        onmessage: null,
        onerror: null,
        readyState: EventSource.CONNECTING,
        addEventListener(type, cb) {
            if (!listeners.has(type)) listeners.set(type, new Set())
            listeners.get(type).add(cb)
        },
        removeEventListener(type, cb) {
            listeners.get(type)?.delete(cb)
        },
        close() {
            this.readyState = EventSource.CLOSED
            controller.abort()
        },
    }
    const emitError = (event) => {
        listeners.get('error')?.forEach((cb) => cb(event))
        emitter.onerror?.(event)
    }

    ;(async () => {
        try {
            const res = await fetch(url, {
                headers: { Authorization: `Bearer ${getJwtToken()}`, Accept: 'text/event-stream' },
                signal: controller.signal,
            })

            if (!res.ok) {
                log.warn('SSE HTTP not OK', { url, status: res.status })
                emitter.readyState = EventSource.CLOSED
                emitError(new Event('error'))
                return
            }

            log.debug('SSE stream connected', url)
            emitter.readyState = EventSource.OPEN
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            while (true) {
                const { done, value } = await reader.read()
                if (done) break

                buffer += decoder.decode(value, { stream: true })
                const events = buffer.split('\n\n')
                buffer = events.pop() // keep incomplete SSE event in buffer

                for (const eventChunk of events) {
                    const lines = eventChunk.split('\n')
                    const dataLines = []
                    for (const line of lines) {
                        if (line.startsWith('data:')) {
                            dataLines.push(line.slice(5).trim())
                        }
                    }
                    if (dataLines.length > 0) {
                        emitter.onmessage?.({ data: dataLines.join('\n') })
                    }
                }
            }

            emitter.readyState = EventSource.CLOSED
        } catch (err) {
            if (err.name !== 'AbortError') {
                log.error('SSE fetch failed', url, err)
                emitter.readyState = EventSource.CLOSED
                emitError(new Event('error'))
            }
        }
    })()

    return emitter
}

function wrapNativeEventSource(source) {
    return {
        get readyState() {
            return source.readyState
        },
        get onmessage() {
            return source.onmessage
        },
        set onmessage(handler) {
            source.onmessage = handler
        },
        get onerror() {
            return source.onerror
        },
        set onerror(handler) {
            source.onerror = handler
        },
        addEventListener(type, cb) {
            source.addEventListener(type, cb)
        },
        removeEventListener(type, cb) {
            source.removeEventListener(type, cb)
        },
        close() {
            source.close()
        },
    }
}

export { ApiError }
