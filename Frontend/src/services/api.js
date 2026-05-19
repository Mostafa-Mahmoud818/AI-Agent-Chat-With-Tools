/**
 * @file Ankabut DXP Chatting HTTP + SSE client.
 * @module services/api
 *
 * @summary
 * **Secure (default):** {@code /api/v1/secure/chatting} + Bearer {@code VITE_API_BEARER_TOKEN} (or local OTP).
 * **Guest:** set {@code VITE_CHAT_AUTH=guest} → {@code /api/v1/public/chatting} + stable UUID {@code clientId}
 * (localStorage + optional cookie {@code ankabut_guest_id}); no JWT.
 *
 * Base URL: {@code VITE_API_ORIGIN}, or {@code VITE_API_RELATIVE=1} for same-origin `/api` (Vite proxy), or {@code VITE_API_BACKEND} preset — see {@link resolveApiOrigin}.
 *
 * **`chatContext` on orchestration start:** required. Persona envelope — see
 * {@link startOrchestration}. Backend resolves it internally to a `resourceId`; the
 * frontend never deals with `resourceId` directly.
 *
 * **Turn history:** {@code GET .../conversations/{id}/turns}. Two backend implementations are supported,
 * selected at runtime by {@code VITE_TURNS_API_MODE}:
 *   - {@code limit} (default) — newer: {@code ?limit=N}, {@code ApiResponse<ConversationTurnDto[]>} newest-first.
 *   - {@code paged}            — legacy: {@code ?page=0&size=N}, {@code ApiResponse<PagedResponse<ConversationTurnDto>>}
 *                                with {@code content[]} oldest-first.
 * {@link getConversationTurns} normalizes both to a newest-first array;
 * {@link fetchAllConversationTurns} reverses to chronological order for the transcript.
 *
 * **SSE payload:** {@code ChattingOrchestrationRoundResponseDto} — {@code status}: ready | processing | error | expired;
 * {@code message}, {@code handledBy}.
 */

import { createLogger } from '../utils/logger.js'
import { resolveApiOrigin } from '../config/apiOrigin.js'
import { getAccessToken } from '../auth/tokenStore.js'
import { isGuestChatAuth } from '../config/chatAuth.js'
import { getOrCreateGuestClientId } from '../auth/guestClientId.js'
import { getRuntimeResourceId } from '../config/runtimeSettings.js'

const log = createLogger('api')

const API_ORIGIN = resolveApiOrigin(import.meta.env)

const PATH_SECURE = '/api/v1/secure/chatting'
const PATH_PUBLIC = '/api/v1/public/chatting'

const REQUEST_TIMEOUT_MS = 15_000

/** Backend {@code ChattingSecureController} / open: {@code @Max(500)} on {@code limit}. */
const MAX_CONVERSATION_TURNS_LIMIT = 500

/** Backend `ChattingOrchestrationStartRequest.resourceId`: `@Size(max = 128)`, nullable. */
const MAX_RESOURCE_ID_LEN = 128

const TURNS_API_MODE_LIMIT = 'limit'
const TURNS_API_MODE_PAGED = 'paged'

/**
 * Selects which `/turns` backend implementation to call.
 * - `limit` (default): newer endpoint, single `?limit=N` query, returns a plain array newest-first.
 * - `paged`:           legacy endpoint, `?page=0&size=N`, returns `PagedResponse` with `content` oldest-first.
 *
 * @returns {'limit'|'paged'}
 */
function getTurnsApiMode() {
    const raw = import.meta.env.VITE_TURNS_API_MODE
    const v = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (v === TURNS_API_MODE_PAGED) return TURNS_API_MODE_PAGED
    if (v && v !== TURNS_API_MODE_LIMIT) {
        log.warn('Unknown VITE_TURNS_API_MODE — falling back to default', { value: raw, default: TURNS_API_MODE_LIMIT })
    }
    return TURNS_API_MODE_LIMIT
}

const IS_TEST = import.meta.env.MODE === 'test'

/**
 * @returns {boolean}
 */
function useGuestAuth() {
    return isGuestChatAuth(import.meta.env)
}

/**
 * Thrown when the modulith returns a non-2xx response or JSON envelope `success: false`.
 * @extends Error
 */
class ApiError extends Error {
    /**
     * @param {number} status HTTP status (0 for network/timeout).
     * @param {string} errorCode Machine-friendly code when known (e.g. `session_expired`, `timeout`).
     * @param {string} message Human-readable message from `ApiResponse` or Spring error JSON.
     */
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
        if (body.message) {
            message = body.message
        } else if (body.error && body.path) {
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

/**
 * Resolves a `resourceId` for orchestration calls that still require one directly.
 * Precedence: explicit arg → runtime setting → {@code VITE_DEFAULT_RESOURCE_ID}.
 *
 * @param {string|null|undefined} explicit
 * @returns {string|null}
 */
function resolveOrchestrationResourceId(explicit) {
    let s = ''
    if (explicit != null && String(explicit).trim() !== '') {
        s = String(explicit).trim()
    } else {
        const runtime = getRuntimeResourceId()
        if (runtime) {
            s = runtime
        } else {
            const raw = import.meta.env.VITE_DEFAULT_RESOURCE_ID
            s = typeof raw === 'string' ? raw.trim() : ''
        }
    }
    if (!s) return null
    if (s.length > MAX_RESOURCE_ID_LEN) {
        log.warn('resourceId longer than backend max — truncating', { max: MAX_RESOURCE_ID_LEN })
        s = s.slice(0, MAX_RESOURCE_ID_LEN)
    }
    return s
}

// ── HTTP helpers ────────────────────────────────────────────────────

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * Appends `clientId` for public guest APIs (required when cookie not sent cross-origin).
 * @param {string} url
 * @returns {string}
 */
export function withGuestClientIdQuery(url) {
    if (!useGuestAuth()) return url
    const id = getOrCreateGuestClientId()
    const joiner = url.includes('?') ? '&' : '?'
    return `${url}${joiner}clientId=${encodeURIComponent(id)}`
}

function bearerAuthHeaders() {
    const token = getAccessToken()
    if (!token) {
        if (IS_TEST) {
            return { ...JSON_HEADERS, Authorization: 'Bearer __vitest_bearer_placeholder__' }
        }
        throw new ApiError(
            0,
            'missing_bearer_token',
            'Missing bearer token. Set VITE_API_BEARER_TOKEN, use local OTP auth, or set VITE_CHAT_AUTH=guest for public API.',
        )
    }
    return { ...JSON_HEADERS, Authorization: `Bearer ${token}` }
}

function buildHeaders() {
    if (useGuestAuth()) {
        return { ...JSON_HEADERS }
    }
    return bearerAuthHeaders()
}

function getChattingPathPrefix() {
    return useGuestAuth() ? PATH_PUBLIC : PATH_SECURE
}

function getApiBase() {
    return `${API_ORIGIN}${getChattingPathPrefix()}`
}

/** Orchestration routes live under `/chatting/orchestration` for both secure and public. */
function getOrchestrationBase() {
    return `${API_ORIGIN}${getChattingPathPrefix()}/orchestration`
}

function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    return fetch(url, { ...options, signal: controller.signal })
        .catch((err) => {
            if (err.name === 'AbortError') {
                log.warn('Request timeout', url)
                throw new ApiError(0, 'timeout', 'Request timed out. Please check your connection.')
            }
            log.error('Network failure', url, err)
            throw new ApiError(0, 'network_error', 'Network error. Is the backend reachable?')
        })
        .finally(() => clearTimeout(timer))
}

async function get(url) {
    const finalUrl = withGuestClientIdQuery(url)
    log.debug('GET', finalUrl)
    const res = await fetchWithTimeout(finalUrl, {
        method: 'GET',
        headers: buildHeaders(),
    })
    log.debug('GET response', finalUrl, res.status)
    return handleResponse(res)
}

async function post(url, body) {
    const finalUrl = withGuestClientIdQuery(url)
    log.debug('POST', finalUrl)
    const res = await fetchWithTimeout(finalUrl, {
        method: 'POST',
        headers: buildHeaders(),
        body: JSON.stringify(body),
    })
    log.debug('POST response', finalUrl, res.status)
    return handleResponse(res)
}

// ── API functions ───────────────────────────────────────────────────

/**
 * @param {{ page?: number, size?: number }} [opts]
 * @returns {Promise<{ content: ConversationDto[], page: number, size: number, last: boolean }>}
 */
export async function getConversations({ page = 0, size = 50 } = {}) {
    const base = getApiBase()
    const qp = new URLSearchParams({ page: String(page), size: String(size) })
    const res = await get(`${base}/conversations?${qp}`)
    return unwrapResponse(res)
}

/**
 * Latest turns for a conversation, always returned as a newest-first array regardless of
 * which backend implementation is active (selected by {@link getTurnsApiMode}).
 *
 * @param {string} conversationId
 * @param {{ limit?: number }} [opts] capped to {@link MAX_CONVERSATION_TURNS_LIMIT}; backend default when omitted is 100.
 * @returns {Promise<object[]>} {@code ConversationTurnDto[]} (newest first)
 */
export async function getConversationTurns(conversationId, { limit = 100 } = {}) {
    const base = getApiBase()
    const n = Math.min(Math.max(1, Number(limit) || 100), MAX_CONVERSATION_TURNS_LIMIT)
    const cid = encodeURIComponent(conversationId)
    const mode = getTurnsApiMode()

    if (mode === TURNS_API_MODE_PAGED) {
        // Legacy: ?page=0&size=N; ApiResponse<PagedResponse<ConversationTurnDto>>; content is oldest-first.
        const qp = new URLSearchParams({ page: '0', size: String(n) })
        const res = await get(`${base}/conversations/${cid}/turns?${qp}`)
        const data = await unwrapResponse(res)
        const content = Array.isArray(data?.content) ? data.content : []
        // Normalize to newest-first to match the limit-mode contract.
        return [...content].reverse()
    }

    // Default: ?limit=N; ApiResponse<ConversationTurnDto[]> newest-first.
    const qp = new URLSearchParams({ limit: String(n) })
    const res = await get(`${base}/conversations/${cid}/turns?${qp}`)
    const data = await unwrapResponse(res)
    return Array.isArray(data) ? data : []
}

/**
 * Loads up to {@code limit} turns and returns them oldest-first for transcript rendering
 * (reverses the API's newest-first order). Conversations with more than 500 turns only return the 500 most recent rows.
 *
 * @param {string} conversationId
 * @param {number} [limit=500] max 500 per backend
 * @returns {Promise<object[]>}
 */
export async function fetchAllConversationTurns(conversationId, limit = MAX_CONVERSATION_TURNS_LIMIT) {
    const turns = await getConversationTurns(conversationId, { limit })
    if (!Array.isArray(turns)) {
        log.warn('getConversationTurns: expected array data', { conversationId, turns })
        return []
    }
    return [...turns].reverse()
}

/**
 * @param {string} inputText Title seed (`initialTitle`, truncated to 50 chars).
 * @param {string|null} [_displayText] Reserved; unused today.
 * @returns {Promise<{ conversationId: string|null }>}
 */
export async function createConversation(inputText, _displayText = null) {
    const base = getApiBase()
    const title = inputText.length > 50 ? inputText.substring(0, 50) + '…' : inputText

    let body
    if (useGuestAuth()) {
        const clientId = getOrCreateGuestClientId()
        body = {
            clientId,
            req: {
                initialTitle: title,
                initialSummary: null,
            },
        }
    } else {
        body = { initialTitle: title }
    }

    const res = await post(`${base}/conversations`, body)
    const conv = await unwrapResponse(res)
    const conversationId = conv.id != null ? String(conv.id) : null
    log.info('Conversation created', { conversationId })
    return { conversationId }
}

/**
 * Starts agent orchestration for the given conversation.
 *
 * The backend requires a `chatContext` envelope (persona / scenario). The frontend
 * has no knowledge of `resourceId` — the backend resolves it internally from the
 * supplied context.
 *
 * @param {string} conversationId
 * @param {string} inputText
 * @param {{ schemaVersion?: string, contextType: string, contextData: object }} chatContext
 *        Required. Shape: `{ schemaVersion?: "1.0", contextType: "VISIT",
 *        contextData: { visitId: "<uuid>" } }`.
 * @param {string|null} [displayText]
 * @returns {Promise<object>}
 */
export async function startOrchestration(conversationId, inputText, chatContext, displayText = null) {
    if (!chatContext || !chatContext.contextType) {
        throw new ApiError(0, 'invalid_chat_context', 'chatContext is required on orchestration start')
    }
    const base = getOrchestrationBase()
    const cid = encodeURIComponent(conversationId)
    const body = {
        inputText,
        chatContext,
        ...(displayText && displayText.trim() ? { displayText: displayText.trim() } : {}),
    }

    const res = await post(`${base}/conversations/${cid}/start`, body)
    const data = await unwrapResponse(res)
    log.info('Orchestration started', {
        conversationId,
        contextType: chatContext.contextType,
        processInstanceKey: data?.processInstanceKey,
    })
    return data
}

/**
 * @param {string} conversationId
 * @param {string} followUpInput
 * @param {string|null} [displayText]
 * @param {string|null} [clientMessageId]
 */
export async function sendReply(conversationId, followUpInput, displayText = null, clientMessageId = null) {
    const base = getOrchestrationBase()
    const cid = encodeURIComponent(conversationId)
    const messageId = clientMessageId ?? crypto.randomUUID()
    log.info('Sending follow-up', {
        conversationId,
        chars: followUpInput?.length ?? 0,
        clientMessageId: messageId,
    })
    await post(`${base}/conversations/${cid}/user-messages`, {
        followUpInput,
        clientMessageId: messageId,
        ...(displayText && displayText.trim() ? { displayText: displayText.trim() } : {}),
    })
}

/**
 * Assistant-round SSE. Bearer (secure) or guest query `clientId`.
 *
 * @param {string} conversationId
 * @returns {{ onmessage: Function|null, onerror: Function|null, close: () => void, readyState: number, addEventListener: Function, removeEventListener: Function }}
 */
export function createResponseStream(conversationId) {
    const base = getOrchestrationBase()
    const cid = encodeURIComponent(conversationId)
    let streamUrl = `${base}/conversations/${cid}/assistant-round/stream`
    streamUrl = withGuestClientIdQuery(streamUrl)
    log.info('SSE open', { conversationId, guest: useGuestAuth() })
    return createFetchEventSource(streamUrl)
}

/**
 * Fetch-based SSE (Bearer when not guest).
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

    const headers = { Accept: 'text/event-stream' }
    if (!useGuestAuth()) {
        const token = getAccessToken()
        if (!token && !IS_TEST) {
            emitter.readyState = EventSource.CLOSED
            queueMicrotask(() => emitError(new Event('error')))
            return emitter
        }
        if (IS_TEST && !token) {
            headers.Authorization = 'Bearer __vitest_bearer_placeholder__'
        } else {
            headers.Authorization = `Bearer ${token}`
        }
    }

    ;(async () => {
        try {
            const res = await fetch(url, {
                headers,
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
                buffer = events.pop() ?? ''

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

export { ApiError }