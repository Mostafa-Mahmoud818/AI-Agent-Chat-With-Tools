/**
 * Ankabut DXP Chatting API — dual-mode (guest cookie + JWT secure).
 *
 * Guest mode  → /api/v1/public/chatting/*  (clientId via ankabut_guest_id cookie)
 * Secure mode → /api/v1/secure/chatting/*  (JWT via Authorization header)
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

function isSecureMode() {
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
 * Creates a new conversation + first session.
 * Returns { conversationId, sessionId }.
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
 * Starts Camunda orchestration for a session.
 * Returns { sessionId, processInstanceKey }.
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
 * Sends a follow-up user message to an active orchestration.
 */
export async function sendReply(sessionId, followUpInput) {
    const base = getApiBase()
    const qp = clientIdParam()
    log.info('Sending follow-up', { sessionId, chars: followUpInput?.length ?? 0 })
    await post(`${base}/orchestration/sessions/${sessionId}/user-messages${qp}`, { followUpInput })
}

/**
 * Opens a Server-Sent Events stream for the given session.
 *
 * In guest mode: uses native EventSource (no auth header needed).
 * In secure mode: uses fetch-based SSE since EventSource doesn't support custom headers.
 *
 * Returns an EventSource-like object with `onmessage`, `onerror`, and `close()`.
 */
export function createResponseStream(sessionId) {
    const base = getApiBase()

    if (!isSecureMode()) {
        // Guest mode: native EventSource
        const qp = clientIdParam()
        const streamUrl = `${base}/orchestration/sessions/${sessionId}/assistant-round/stream${qp}`
        log.info('SSE open (guest EventSource)', { sessionId })
        return new EventSource(streamUrl)
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
    const emitter = {
        onmessage: null,
        onerror: null,
        readyState: EventSource.CONNECTING,
        close() {
            this.readyState = EventSource.CLOSED
            controller.abort()
        },
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
                emitter.onerror?.(new Event('error'))
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
                const lines = buffer.split('\n')
                buffer = lines.pop() // keep incomplete line in buffer

                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        const data = line.slice(5).trim()
                        if (data) {
                            emitter.onmessage?.({ data })
                        }
                    }
                }
            }

            emitter.readyState = EventSource.CLOSED
        } catch (err) {
            if (err.name !== 'AbortError') {
                log.error('SSE fetch failed', url, err)
                emitter.readyState = EventSource.CLOSED
                emitter.onerror?.(new Event('error'))
            }
        }
    })()

    return emitter
}

export { ApiError }
