/**
 * @file Ankabut DXP Chatting HTTP + SSE client (JWT secure only).
 * @module services/api
 *
 * @summary
 * **Secure:** {@code /api/v1/secure/chatting} + Bearer from email OTP sign-in
 * (or {@code VITE_API_BEARER_TOKEN} for CI). Public guest chatting was removed server-side.
 *
 * Base URL: {@code VITE_API_ORIGIN}, or {@code VITE_API_RELATIVE=1} for same-origin `/api`
 * (Vite proxy), or {@code VITE_API_BACKEND} preset — see {@link resolveApiOrigin}.
 *
 * **`chatContext` on orchestration start:** VISIT or STUDENT envelope — see
 * {@code personaSession.getChatContextForStart} and {@link startOrchestration}.
 *
 * **Turn history:** {@code GET .../conversations/{id}/turns?limit=N} →
 * {@code ApiResponse<ConversationTurnDto[]>} chronological (oldest first).
 *
 * **SSE payload:** {@code AssistantTurnReplyDto} — {@code status}: ready | processing | error | expired;
 * {@code message}, {@code handledBy}.
 */

import {createLogger} from '../utils/logger.js'
import {resolveApiOrigin} from '../config/apiOrigin.js'
import {ensureFreshAccessToken, refreshAccessToken} from '../auth/tokenRefresh.js'
import {isValidContextId} from '../config/chatContext.js'
import {
    ABSENCE_ATTACHMENT_MAX_BYTES,
    AUDIO_MAX_BYTES,
    clampChatInput,
    clampConversationTitle,
    clampDisplayText,
} from '../config/chattingValidationLimits.js'

const log = createLogger('api')

const API_ORIGIN = resolveApiOrigin(import.meta.env)

const PATH_SECURE = '/api/v1/secure/chatting'
const SPEECH_PATH_SECURE = '/api/v1/secure/speech'
const STUDENTS_PATH_SECURE = '/api/v1/secure/students'
const ERRORBANNER_PATH_SECURE = '/api/v1/secure/errorbanner'

const REQUEST_TIMEOUT_MS = 15_000
/**
 * Orchestration POST (/start, /user-messages) waits on servlet-bound Camunda correlate (~25s).
 * Must exceed that bound so the client does not abort while the backend may still succeed.
 */
export const ORCHESTRATION_POST_TIMEOUT_MS = 35_000
/** STT provider latency can exceed normal JSON chat calls. */
const TRANSCRIBE_TIMEOUT_MS = 60_000

/** Backend {@code ChattingSecureController}: {@code @Max(500)} on {@code limit}. */
const MAX_CONVERSATION_TURNS_LIMIT = 500

const IS_TEST = import.meta.env.MODE === 'test'

/** Backend SSE cap message from {@code AgentResponsePushService}. */
export const SSE_CONCURRENT_STREAMS_ERROR =
    'Too many concurrent assistant streams for this client.'

/** Max conversations loaded across paginated sidebar fetches. */
const MAX_CONVERSATIONS_LOAD = 500

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
        if (res.status === 403) errorCode = 'forbidden'
        if (res.status === 429) errorCode = 'rate_limited'
        if (res.status === 503) errorCode = 'service_unavailable'
        if (res.status === 422) errorCode = 'unprocessable'
    } catch {
        if (raw?.trim()) {
            log.warn('Non-JSON error body (first 400 chars)', raw.slice(0, 400))
        }
    }

    log.warn('HTTP error', {status: res.status, errorCode, message})
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

const JSON_HEADERS = {'Content-Type': 'application/json'}

/**
 * Resolves the bearer token for a request, proactively refreshing it first when the stored token
 * is expired (or about to be) and a refresh token is available — see {@link ensureFreshAccessToken}.
 */
async function bearerAuthHeaders() {
    const token = await ensureFreshAccessToken(import.meta.env)
    if (!token) {
        if (IS_TEST) {
            return {...JSON_HEADERS, Authorization: 'Bearer __vitest_bearer_placeholder__'}
        }
        throw new ApiError(
            0,
            'missing_bearer_token',
            'Missing bearer token. Sign in via email OTP in the auth dialog, or set VITE_API_BEARER_TOKEN for automation.',
        )
    }
    return {...JSON_HEADERS, Authorization: `Bearer ${token}`}
}

async function buildHeaders() {
    return bearerAuthHeaders()
}

/**
 * Retries a request once after forcing a token refresh when it fails with 401.
 *
 * @param {() => Promise<Response>} makeRequest
 * @returns {Promise<Response>}
 */
async function requestWithAuthRetry(makeRequest) {
    try {
        return await makeRequest()
    } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
            try {
                await refreshAccessToken(import.meta.env)
            } catch (refreshErr) {
                log.warn('Token refresh after 401 failed', refreshErr)
                throw err
            }
            return await makeRequest()
        }
        throw err
    }
}

/** Multipart uploads must not set Content-Type — the browser adds the boundary. */
async function buildMultipartAuthHeaders() {
    const token = await ensureFreshAccessToken(import.meta.env)
    if (!token) {
        if (IS_TEST) {
            return {Authorization: 'Bearer __vitest_bearer_placeholder__'}
        }
        throw new ApiError(
            0,
            'missing_bearer_token',
            'Missing bearer token. Sign in via email OTP in the auth dialog, or set VITE_API_BEARER_TOKEN for automation.',
        )
    }
    return {Authorization: `Bearer ${token}`}
}

function getApiBase() {
    return `${API_ORIGIN}${PATH_SECURE}`
}

function getOrchestrationBase() {
    return `${API_ORIGIN}${PATH_SECURE}/orchestration`
}

function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    return fetch(url, {...options, signal: controller.signal})
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
    return requestWithAuthRetry(async () => {
        log.debug('GET', url)
        const res = await fetchWithTimeout(url, {
            method: 'GET',
            headers: await buildHeaders(),
        })
        log.debug('GET response', url, res.status)
        return handleResponse(res)
    })
}

async function post(url, body, timeoutMs = REQUEST_TIMEOUT_MS) {
    return requestWithAuthRetry(async () => {
        log.debug('POST', url)
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: await buildHeaders(),
            body: JSON.stringify(body),
        }, timeoutMs)
        log.debug('POST response', url, res.status)
        return handleResponse(res)
    })
}

async function del(url) {
    return requestWithAuthRetry(async () => {
        log.debug('DELETE', url)
        const res = await fetchWithTimeout(url, {
            method: 'DELETE',
            headers: await buildHeaders(),
        })
        log.debug('DELETE response', url, res.status)
        return handleResponse(res)
    })
}

// ── API functions ───────────────────────────────────────────────────

/**
 * Lists conversations for the current client. `archived=false` (default) returns non-archived
 * conversations; `archived=true` returns archived ones. Soft-deleted conversations are never returned.
 *
 * @param {{ page?: number, size?: number, archived?: boolean }} [opts]
 * @returns {Promise<{ content: ConversationDto[], page: number, size: number, last: boolean }>}
 */
export async function getConversations({page = 0, size = 50, archived = false} = {}) {
    const base = getApiBase()
    const qp = new URLSearchParams({page: String(page), size: String(size)})
    if (archived) qp.set('archived', 'true')
    const res = await get(`${base}/conversations?${qp}`)
    return unwrapResponse(res)
}

/**
 * Loads all conversation pages up to {@link MAX_CONVERSATIONS_LOAD} rows for the sidebar.
 *
 * @param {{ size?: number, archived?: boolean }} [opts]
 * @returns {Promise<object[]>}
 */
export async function loadAllConversations({size = 100, archived = false} = {}) {
    const pageSize = Math.min(Math.max(1, size), 100)
    const all = []
    let page = 0
    let last = false

    while (!last && all.length < MAX_CONVERSATIONS_LOAD) {
        const data = await getConversations({page, size: pageSize, archived})
        const chunk = Array.isArray(data.content) ? data.content : []
        all.push(...chunk)
        last = data.last === true || chunk.length < pageSize
        page += 1
        if (chunk.length === 0) break
    }

    return all.slice(0, MAX_CONVERSATIONS_LOAD)
}

/**
 * Latest turns for a conversation, returned chronologically (oldest first) within the latest-N window.
 *
 * @param {string} conversationId
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<object[]>}
 */
export async function getConversationTurns(conversationId, {limit = 100} = {}) {
    const base = getApiBase()
    const n = Math.min(Math.max(1, Number(limit) || 100), MAX_CONVERSATION_TURNS_LIMIT)
    const cid = encodeURIComponent(conversationId)
    const qp = new URLSearchParams({limit: String(n)})
    const res = await get(`${base}/conversations/${cid}/turns?${qp}`)
    const data = await unwrapResponse(res)
    return Array.isArray(data) ? data : []
}

/**
 * Loads up to {@code limit} turns for transcript rendering, already chronological (oldest first).
 *
 * @param {string} conversationId
 * @param {number} [limit=500]
 * @returns {Promise<object[]>}
 */
export async function fetchAllConversationTurns(conversationId, limit = MAX_CONVERSATION_TURNS_LIMIT) {
    const turns = await getConversationTurns(conversationId, {limit})
    if (!Array.isArray(turns)) {
        log.warn('fetchAllConversationTurns: expected array data', {conversationId, turns})
        return []
    }
    return turns
}

/**
 * @param {string} inputText Title seed (`initialTitle`, truncated to 50 chars).
 * @param {string|null} [_displayText] Reserved; unused today.
 * @returns {Promise<{ conversationId: string|null }>}
 */
export async function createConversation(inputText, _displayText = null) {
    const base = getApiBase()
    const title = clampConversationTitle(inputText)
    const body = {initialTitle: title}

    const res = await post(`${base}/conversations`, body)
    const conv = await unwrapResponse(res)
    const conversationId = conv.id != null ? String(conv.id) : null
    log.info('Conversation created', {conversationId})
    return {conversationId}
}

/**
 * Soft-deletes a conversation (idempotent; backend returns 204 No Content).
 *
 * @param {string} conversationId
 * @returns {Promise<void>}
 */
export async function deleteConversation(conversationId) {
    const base = getApiBase()
    const cid = encodeURIComponent(conversationId)
    await del(`${base}/conversations/${cid}`)
    log.info('Conversation soft-deleted', {conversationId})
}

/**
 * Archives a conversation (idempotent).
 *
 * @param {string} conversationId
 * @returns {Promise<object>}
 */
export async function archiveConversation(conversationId) {
    const base = getApiBase()
    const cid = encodeURIComponent(conversationId)
    const res = await post(`${base}/conversations/${cid}/archive`, {})
    const conv = await unwrapResponse(res)
    log.info('Conversation archived', {conversationId})
    return conv
}

/**
 * Reverses an archive (idempotent).
 *
 * @param {string} conversationId
 * @returns {Promise<object>}
 */
export async function unarchiveConversation(conversationId) {
    const base = getApiBase()
    const cid = encodeURIComponent(conversationId)
    const res = await post(`${base}/conversations/${cid}/unarchive`, {})
    const conv = await unwrapResponse(res)
    log.info('Conversation unarchived', {conversationId})
    return conv
}

/**
 * Starts agent orchestration for the given conversation.
 *
 * @param {string} conversationId
 * @param {string} inputText
 * @param {{ schemaVersion?: string, contextType: string, contextData: { id: string } }} chatContext
 *        Required. Shape: `{ schemaVersion: "1.0", contextType: "VISIT"|"STUDENT",
 *        contextData: { id: "<uuid>" } }`.
 * @param {string|null} [displayText]
 * @returns {Promise<object>}
 */
export async function startOrchestration(conversationId, inputText, chatContext, displayText = null) {
    if (!chatContext || !chatContext.contextType) {
        throw new ApiError(0, 'invalid_chat_context', 'chatContext is required on orchestration start')
    }
    if (!isValidContextId(chatContext.contextData?.id)) {
        throw new ApiError(
            0,
            'invalid_chat_context',
            'chatContext.contextData.id must be a UUID (canonical id key; visitId alias is not accepted)',
        )
    }
    const base = getOrchestrationBase()
    const cid = encodeURIComponent(conversationId)
    const safeInput = clampChatInput(inputText)
    const safeDisplay = clampDisplayText(displayText)
    const body = {
        inputText: safeInput,
        chatContext,
        ...(safeDisplay ? {displayText: safeDisplay} : {}),
    }

    const res = await post(`${base}/conversations/${cid}/start`, body, ORCHESTRATION_POST_TIMEOUT_MS)
    const data = await unwrapResponse(res)
    log.info('Orchestration started', {
        conversationId,
        contextType: chatContext.contextType,
        processInstanceKey: data?.processInstanceKey,
    })
    return data
}

/**
 * Transcribes audio via the modulith speech module.
 *
 * @param {Blob} audioBlob
 * @param {{ filename?: string, languageHint?: string|null }} [opts]
 * @returns {Promise<{ text: string, language: string|null }>}
 */
export async function transcribeSpeech(audioBlob, {filename = 'recording.webm', languageHint = null} = {}) {
    if (audioBlob.size > AUDIO_MAX_BYTES) {
        throw new ApiError(0, 'audio_too_large', 'Recording is too large (max 25 MB). Please record a shorter clip.')
    }
    let url = `${API_ORIGIN}${SPEECH_PATH_SECURE}/transcriptions`
    if (languageHint) {
        const joiner = url.includes('?') ? '&' : '?'
        url = `${url}${joiner}languageHint=${encodeURIComponent(languageHint)}`
    }
    const formData = new FormData()
    formData.append('audio', audioBlob, filename)
    log.debug('POST transcribe', url, {bytes: audioBlob.size, type: audioBlob.type})
    const ok = await requestWithAuthRetry(async () => {
        const res = await fetchWithTimeout(
            url,
            {
                method: 'POST',
                headers: await buildMultipartAuthHeaders(),
                body: formData,
            },
            TRANSCRIBE_TIMEOUT_MS,
        )
        log.debug('POST transcribe response', url, res.status)
        return handleResponse(res)
    })
    const data = await unwrapResponse(ok)
    log.info('Transcription OK', {chars: data?.text?.length ?? 0, language: data?.language})
    return data
}

/**
 * Stages an absence supporting document for chat. Relay {@code chatFollowUpMessage} verbatim
 * as the next orchestration follow-up.
 *
 * @param {File|Blob} file
 * @param {{ filename?: string }} [opts]
 * @returns {Promise<{ originalFileName: string, contentType: string, sizeBytes: number, chatFollowUpMessage: string }>}
 */
export async function uploadAbsenceChatAttachment(file, {filename} = {}) {
    if (!file) {
        throw new ApiError(0, 'missing_file', 'A supporting document file is required.')
    }
    const size = typeof file.size === 'number' ? file.size : 0
    if (size > ABSENCE_ATTACHMENT_MAX_BYTES) {
        throw new ApiError(0, 'file_too_large', 'Supporting document must not exceed 10 MB.')
    }
    const url = `${API_ORIGIN}${STUDENTS_PATH_SECURE}/absence-requests/attachments`
    const formData = new FormData()
    const name = filename
        || (typeof File !== 'undefined' && file instanceof File && file.name)
        || 'attachment'
    formData.append('file', file, name)
    log.debug('POST absence attachment', url, {bytes: size, type: file.type})
    const ok = await requestWithAuthRetry(async () => {
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: await buildMultipartAuthHeaders(),
            body: formData,
        })
        log.debug('POST absence attachment response', url, res.status)
        return handleResponse(res)
    })
    const data = await unwrapResponse(ok)
    log.info('Absence attachment staged', {
        originalFileName: data?.originalFileName,
        sizeBytes: data?.sizeBytes,
    })
    return data
}

/**
 * Stages an error-banner screenshot/document for chat. Relay {@code chatFollowUpMessage} verbatim.
 *
 * @param {File|Blob} file
 * @param {{ filename?: string }} [opts]
 * @returns {Promise<{ originalFileName: string, contentType: string, sizeBytes: number, chatFollowUpMessage: string }>}
 */
export async function uploadErrorBannerChatAttachment(file, {filename} = {}) {
    if (!file) {
        throw new ApiError(0, 'missing_file', 'A supporting document file is required.')
    }
    const size = typeof file.size === 'number' ? file.size : 0
    if (size > ABSENCE_ATTACHMENT_MAX_BYTES) {
        throw new ApiError(0, 'file_too_large', 'Supporting document must not exceed 10 MB.')
    }
    const url = `${API_ORIGIN}${ERRORBANNER_PATH_SECURE}/attachments`
    const formData = new FormData()
    const name = filename
        || (typeof File !== 'undefined' && file instanceof File && file.name)
        || 'attachment'
    formData.append('file', file, name)
    log.debug('POST error-banner attachment', url, {bytes: size, type: file.type})
    const ok = await requestWithAuthRetry(async () => {
        const res = await fetchWithTimeout(url, {
            method: 'POST',
            headers: await buildMultipartAuthHeaders(),
            body: formData,
        })
        log.debug('POST error-banner attachment response', url, res.status)
        return handleResponse(res)
    })
    const data = await unwrapResponse(ok)
    log.info('Error-banner attachment staged', {
        originalFileName: data?.originalFileName,
        sizeBytes: data?.sizeBytes,
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
    const safeInput = clampChatInput(followUpInput)
    const safeDisplay = clampDisplayText(displayText)
    log.info('Sending follow-up', {
        conversationId,
        chars: safeInput.length,
        clientMessageId: messageId,
    })
    await post(`${base}/conversations/${cid}/user-messages`, {
        followUpInput: safeInput,
        clientMessageId: messageId,
        ...(safeDisplay ? {displayText: safeDisplay} : {}),
    }, ORCHESTRATION_POST_TIMEOUT_MS)
}

/**
 * Assistant-round SSE (Bearer JWT).
 *
 * @param {string} conversationId
 * @returns {{ onmessage: Function|null, onerror: Function|null, close: () => void, readyState: number, addEventListener: Function, removeEventListener: Function }}
 */
export function createResponseStream(conversationId) {
    const base = getOrchestrationBase()
    const cid = encodeURIComponent(conversationId)
    const streamUrl = `${base}/conversations/${cid}/assistant-round/stream`
    log.info('SSE open', {conversationId})
    return createFetchEventSource(streamUrl)
}

/** Mirror browser EventSource readyState values (jsdom may omit EventSource). */
const SSE_CONNECTING = 0
const SSE_OPEN = 1
const SSE_CLOSED = 2

/**
 * Fetch-based SSE with Bearer auth.
 * Frames are split on blank lines; trailing buffer + TextDecoder are flushed at EOF.
 * Graceful close with no terminal frame invokes {@code onclosedWithoutTerminal}.
 */
function createFetchEventSource(url) {
    const controller = new AbortController()
    const listeners = new Map([['error', new Set()]])
    const emitter = {
        onmessage: null,
        onerror: null,
        /** Called when the HTTP body ends without a ready/error/expired frame. */
        onclosedWithoutTerminal: null,
        readyState: SSE_CONNECTING,
        addEventListener(type, cb) {
            if (!listeners.has(type)) listeners.set(type, new Set())
            listeners.get(type).add(cb)
        },
        removeEventListener(type, cb) {
            listeners.get(type)?.delete(cb)
        },
        close() {
            this.readyState = SSE_CLOSED
            controller.abort()
        },
    }
    const emitError = (event) => {
        listeners.get('error')?.forEach((cb) => cb(event))
        emitter.onerror?.(event)
    }

    async function resolveHeaders(force) {
        const headers = {Accept: 'text/event-stream'}
        const token = force
            ? await refreshAccessToken(import.meta.env)
            : await ensureFreshAccessToken(import.meta.env)
        if (!token && !IS_TEST) return null
        headers.Authorization = `Bearer ${IS_TEST && !token ? '__vitest_bearer_placeholder__' : token}`
        return headers
    }

    const isTerminalStatus = (data) => {
        try {
            const parsed = JSON.parse(data)
            return parsed?.status === 'ready'
                || parsed?.status === 'error'
                || parsed?.status === 'expired'
        } catch {
            return false
        }
    }

    ;(async () => {
        let sawTerminal = false
        try {
            let headers = await resolveHeaders(false)
            if (!headers) {
                emitter.readyState = SSE_CLOSED
                emitError(new Event('error'))
                return
            }

            let res = await fetch(url, {headers, signal: controller.signal})

            if (res.status === 401) {
                try {
                    headers = await resolveHeaders(true)
                } catch (refreshErr) {
                    log.warn('SSE token refresh after 401 failed', refreshErr)
                    headers = null
                }
                if (headers) {
                    res = await fetch(url, {headers, signal: controller.signal})
                }
            }

            if (!res.ok) {
                log.warn('SSE HTTP not OK', {url, status: res.status})
                emitter.readyState = SSE_CLOSED
                emitError(new Event('error'))
                return
            }

            log.debug('SSE stream connected', url)
            emitter.readyState = SSE_OPEN
            const reader = res.body.getReader()
            const decoder = new TextDecoder()
            let buffer = ''

            const dispatchData = (data) => {
                if (isTerminalStatus(data)) sawTerminal = true
                emitter.onmessage?.({data})
            }

            const drainCompleteFrames = () => {
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
                        dispatchData(dataLines.join('\n'))
                    }
                }
            }

            const flushTrailingBuffer = () => {
                buffer += decoder.decode()
                if (!buffer.trim()) return
                const lines = buffer.split('\n')
                buffer = ''
                const dataLines = []
                for (const line of lines) {
                    if (line.startsWith('data:')) {
                        dataLines.push(line.slice(5).trim())
                    }
                }
                if (dataLines.length > 0) {
                    dispatchData(dataLines.join('\n'))
                }
            }

            while (true) {
                const {done, value} = await reader.read()
                if (done) {
                    flushTrailingBuffer()
                    break
                }

                buffer += decoder.decode(value, {stream: true})
                drainCompleteFrames()
            }

            emitter.readyState = SSE_CLOSED
            if (!sawTerminal) {
                log.warn('SSE closed without terminal frame', {url})
                try {
                    emitter.onclosedWithoutTerminal?.()
                } catch (cbErr) {
                    log.warn('onclosedWithoutTerminal failed', cbErr)
                }
            }
        } catch (err) {
            if (err.name === 'AbortError') {
                emitter.readyState = SSE_CLOSED
                return
            }
            log.error('SSE fetch failed', url, err)
            emitter.readyState = SSE_CLOSED
            emitError(new Event('error'))
        }
    })()

    return emitter
}

export {ApiError}
