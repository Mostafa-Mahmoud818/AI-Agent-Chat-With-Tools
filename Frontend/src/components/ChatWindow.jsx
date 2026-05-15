import { useState, useRef, useEffect, useCallback } from 'react'
import PropTypes from 'prop-types'
import {
    createConversation,
    startOrchestration,
    sendReply,
    createResponseStream,
    fetchAllConversationTurns,
    getSessionsForConversation,
    createSessionInConversation,
    ApiError,
} from '../services/api'
import { parseAgentMessage, turnsToMessages } from '../utils/agentMessage.js'
import { formatMenuSelectionMessage } from '../utils/menuSelection.js'
import {
    cacheLevel,
    getCachedLevel,
    invalidateSession,
    isRestartIntent,
    setActiveSession,
} from '../utils/menuCache.js'
import { createLogger } from '../utils/logger.js'
import MessageBubble from './MessageBubble'
import ChatInput from './ChatInput'
import ThinkingIndicator from './ThinkingIndicator'
import SparkIcon from './SparkIcon'
import './ChatWindow.css'

const log = createLogger('ChatWindow')

/**
 * Quick prompt suggestions for new conversations.
 * These are demo examples — actual routing and handling is determined by the backend
 * AI orchestration service based on intent classification.
 * Supported route categories: catering, it_support, facilities_maintenance (see TurnDto routeCategory enum).
 */
const QUICK_PROMPTS = [
    'Show me the catering products menu',
    'Show me the catering product categories',
    'Create a support ticket for my laptop issue',
    'I need help with my VPN connection',
    'Submit a facilities & maintenance request',
    'The AC in meeting room 3 is not working',
    'I need cleaning scheduled for my office',
]

/**
 * Visit persona placeholder used when `VITE_DEFAULT_VISIT_ID` is not provided.
 * The Phase-1 backend resolver ignores the actual `visitId` value (it returns a hardcoded
 * `resourceId`), so an all-zero UUID is fine for dev. In production the visitId will be
 * sourced from the visit/session context, not from env.
 */
const FALLBACK_VISIT_ID = '00000000-0000-0000-0000-000000000000'

/**
 * Builds the `chatContext` envelope sent on orchestration start.
 *
 * Today only the VISIT persona is supported by the backend. The visitId is taken from
 * `VITE_DEFAULT_VISIT_ID` when set; otherwise a fallback all-zero UUID is used and a
 * warning is logged so devs can see it.
 *
 * @returns {{ schemaVersion: string, contextType: 'VISIT', contextData: { visitId: string } }}
 */
function getChatContext() {
    const raw = import.meta.env.VITE_DEFAULT_VISIT_ID
    const visitId = raw != null && String(raw).trim() !== '' ? String(raw).trim() : null
    if (!visitId) {
        log.warn('VITE_DEFAULT_VISIT_ID not set — using placeholder visitId', { visitId: FALLBACK_VISIT_ID })
    }
    return {
        schemaVersion: '1.0',
        contextType: 'VISIT',
        contextData: { visitId: visitId ?? FALLBACK_VISIT_ID },
    }
}

function isSessionGone(err) {
    return err instanceof ApiError &&
        (err.errorCode === 'session_expired' || err.status === 410)
}

/**
 * Resolves the active session for a conversation.
 * 
 * SessionStatus enum values (from backend):
 * - ACTIVE: Session is actively processing
 * - TIMED_OUT: Session expired due to inactivity
 * - ENDED: Session completed normally
 * - ERROR: Session encountered an error
 * 
 * If an active session exists, it is resumed. Otherwise, a new session is created
 * and the latest previous session ID is tracked for context resumption.
 */
async function resolveSessionForConversation(conversationId) {
    const page = await getSessionsForConversation(conversationId, { page: 0, size: 50 })
    const sessions = page.content || []
    
    // Look for active session first
    const activeSession = sessions.find((s) => {
        // Backend returns SessionStatus enum (ACTIVE, TIMED_OUT, ENDED, ERROR)
        const status = s.status?.toString?.() ?? s.status
        return status === 'ACTIVE'
    })
    
    if (activeSession) {
        log.debug('Found active session', { sessionId: activeSession.id })
        return { sessionId: activeSession.id, previousSessionId: null, createdNew: false }
    }
    
    // No active session — create a new one and reference the most recent for context
    const prevLatest = sessions[0] ?? null
    const newSession = await createSessionInConversation(conversationId, null)
    
    log.info('Created new session', {
        sessionId: newSession.id,
        previousSessionId: prevLatest?.id ?? null,
    })
    
    return {
        sessionId: newSession.id,
        previousSessionId: prevLatest?.id ?? null,
        createdNew: true,
    }
}

export default function ChatWindow({
    sidebarConversationId = null,
    onNewChat: onNewChatParent,
    onConversationCreated,
}) {
    const [messages, setMessages] = useState([])
    const [conversationId, setConversationId] = useState(null)
    const [sessionId, setSessionId] = useState(null)
    const [phase, setPhase] = useState('idle') // idle | thinking | ready | expired
    const [error, setError] = useState(null)
    const [sending, setSending] = useState(false)
    const [conversationLoading, setConversationLoading] = useState(false)
    const [firstOutgoingNeedsStart, setFirstOutgoingNeedsStart] = useState(false)
    const [resumePreviousSessionId, setResumePreviousSessionId] = useState(null)
    const messagesEndRef = useRef(null)
    const chatInputRef = useRef(null)
    const esRef = useRef(null)

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    useEffect(() => {
        log.debug('phase', phase)
    }, [phase])

    /** Menu cache is strictly per-session (BRD) — switching sessions clears the previous session's cache. */
    useEffect(() => {
        setActiveSession(sessionId)
    }, [sessionId])

    useEffect(() => {
        return () => {
            if (esRef.current) {
                esRef.current.close()
                esRef.current = null
            }
        }
    }, [])

    const addMessage = useCallback((role, text, optsOrHandledBy = null, payload = null) => {
        const handledBy = optsOrHandledBy && typeof optsOrHandledBy === 'object' ? null : optsOrHandledBy
        const displayText = optsOrHandledBy && typeof optsOrHandledBy === 'object' ? (optsOrHandledBy.displayText ?? null) : null
        setMessages((prev) => [...prev, { id: crypto.randomUUID(), role, text, displayText, timestamp: new Date(), handledBy, payload }])
    }, [])

    /** Cache/invalidate hooks triggered by an incoming AI payload. Must run for every menu bubble we render. */
    const applyCacheSideEffects = useCallback((sid, payload) => {
        if (!sid || !payload) return
        if (payload.subtype === 'order_confirmation') {
            invalidateSession(sid)
            return
        }
        if (payload.subtype === 'menu' && Array.isArray(payload.breadcrumb) && payload.breadcrumb.length > 0) {
            const last = payload.breadcrumb[payload.breadcrumb.length - 1]
            if (last?.levelKey) cacheLevel(sid, last.levelKey, payload)
        }
    }, [])

    const stopStreaming = useCallback(() => {
        if (esRef.current) {
            esRef.current.close()
            esRef.current = null
        }
    }, [])

    const handleSessionExpired = useCallback(() => {
        stopStreaming()
        setPhase('expired')
        addMessage('system', 'Session has expired due to inactivity. Please start a new conversation.')
    }, [stopStreaming, addMessage])

    /** When parent clears sidebar selection, reset local chat state. */
    useEffect(() => {
        if (sidebarConversationId != null) return
        stopStreaming()
        setMessages([])
        setConversationId(null)
        setSessionId(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
        setResumePreviousSessionId(null)
    }, [sidebarConversationId, stopStreaming])

    /** Load history + session when user picks a conversation in the sidebar. */
    useEffect(() => {
        if (!sidebarConversationId) return undefined

        let cancelled = false

        async function load() {
            stopStreaming()
            setConversationLoading(true)
            setError(null)
            setFirstOutgoingNeedsStart(false)
            setResumePreviousSessionId(null)
            try {
                const turns = await fetchAllConversationTurns(sidebarConversationId)
                if (cancelled) return
                const sessionInfo = await resolveSessionForConversation(sidebarConversationId)
                if (cancelled) return
                const loadedMessages = turnsToMessages(turns)
                setMessages(loadedMessages)
                setConversationId(sidebarConversationId)
                setSessionId(sessionInfo.sessionId)
                // Seed the cache from history so breadcrumb replay works after refresh/session-switch.
                for (const m of loadedMessages) {
                    if (m.role === 'ai') applyCacheSideEffects(sessionInfo.sessionId, m.payload)
                }
                setFirstOutgoingNeedsStart(sessionInfo.createdNew)
                setResumePreviousSessionId(sessionInfo.previousSessionId)
                setPhase(turns.length > 0 ? 'ready' : 'idle')
                setTimeout(() => chatInputRef.current?.focus(), 50)
            } catch (err) {
                if (cancelled) return
                log.error('Failed to load conversation', err)
                const msg = err instanceof ApiError ? err.message : 'Failed to load conversation'
                setError(msg)
                setMessages([])
                setConversationId(null)
                setSessionId(null)
                setPhase('idle')
            } finally {
                if (!cancelled) setConversationLoading(false)
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [sidebarConversationId, stopStreaming, applyCacheSideEffects])

    const startStreaming = useCallback((sid) => {
        stopStreaming()

        const es = createResponseStream(sid)
        esRef.current = es
        let terminalHandled = false

        const setReadyWithError = (message) => {
            terminalHandled = true
            stopStreaming()
            setError(message)
            setPhase('ready')
            setTimeout(() => chatInputRef.current?.focus(), 100)
        }

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)
                // Backend emits processing -> terminal (ready/error/expired); only terminal events close stream.
                if (data.status === 'processing') {
                    setPhase('thinking')
                    return
                }

                if (data.status === 'ready' && data.message) {
                    log.info('SSE assistant ready', { handledBy: data.handledBy, messageChars: data.message?.length })
                    terminalHandled = true
                    stopStreaming()
                    const { text, payload } = parseAgentMessage(data.message)
                    applyCacheSideEffects(sid, payload)
                    addMessage('ai', text, data.handledBy, payload)
                    setPhase('ready')
                    setError(null)
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }

                if (data.status === 'error') {
                    log.warn('SSE assistant error', { message: data.message })
                    setReadyWithError(data.message || 'An error occurred while processing your request.')
                    return
                }

                if (data.status === 'expired') {
                    log.info('SSE session expired event')
                    terminalHandled = true
                    stopStreaming()
                    handleSessionExpired()
                }
            } catch (err) {
                log.error('SSE message parse error', err)
            }
        }

        es.addEventListener('error', (event) => {
            if (event.data) {
                try {
                    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
                    if (data.status === 'expired') {
                        terminalHandled = true
                        stopStreaming()
                        handleSessionExpired()
                        return
                    }
                    if (data.status === 'error' || data.message) {
                        setReadyWithError(data.message || 'An error occurred.')
                    }
                } catch {
                    // ignore parse errors
                }
            }
        })

        es.onerror = () => {
            if (terminalHandled) return
            if (es.readyState === EventSource.CLOSED) {
                log.warn('SSE connection closed', { sessionId: sid })
                setReadyWithError('Connection lost. Please try again.')
            }
        }
    }, [addMessage, stopStreaming, handleSessionExpired, applyCacheSideEffects])

    const handleSendMessage = useCallback(async (text, opts = {}) => {
        if (sending || conversationLoading) return

        if (!sessionId && opts.displayText) {
            log.warn('handleSendMessage: displayText on first message is unexpected (menu click without session)', { displayText: opts.displayText })
        }

        // BRD BR-14: typed restart intent invalidates the client-side menu cache
        // so the next browse call fetches fresh data rather than replaying a cached level.
        if (sessionId && isRestartIntent(text)) {
            invalidateSession(sessionId)
        }

        setError(null)
        setSending(true)
        addMessage('user', text, { displayText: opts.displayText ?? null })
        setPhase('thinking')

        try {
            if (!sessionId) {
                const { conversationId: convId, sessionId: sessId } = await createConversation(text, opts.displayText ?? null)
                setConversationId(convId)
                setSessionId(sessId)
                setFirstOutgoingNeedsStart(false)
                setResumePreviousSessionId(null)
                onConversationCreated?.()
                await startOrchestration(sessId, text, getChatContext(), opts.displayText ?? null)
                startStreaming(sessId)
            } else if (firstOutgoingNeedsStart) {
                await startOrchestration(sessionId, text, getChatContext(), opts.displayText ?? null)
                setFirstOutgoingNeedsStart(false)
                setResumePreviousSessionId(null)
                startStreaming(sessionId)
            } else {
                await sendReply(sessionId, text, opts.displayText ?? null)
                startStreaming(sessionId)
            }
        } catch (err) {
            if (isSessionGone(err)) {
                log.info('Session gone (410 / expired)', { sessionId })
                handleSessionExpired()
                return
            }
            if (err instanceof ApiError && err.status === 400) {
                log.warn('API validation error', { status: err.status, code: err.errorCode, message: err.message })
                setError(err.message)
                setPhase(sessionId ? 'ready' : 'idle')
                return
            }
            if (err instanceof ApiError && err.status === 409) {
                // 409 can come from two backend guards:
                //   1. /start: a Camunda process instance is already registered for this session
                //      (double-click race). The original start already succeeded.
                //   2. /user-messages: the same clientMessageId was already persisted within
                //      the 24h dedup window (retry after a network hiccup). The original reply
                //      already reached Zeebe.
                // Either way the server-side work is already in flight, so the optimistic
                // user bubble we just painted is correct — drop phase back to ready and let
                // the SSE stream deliver the assistant response.
                log.info('409 conflict — treating as already-delivered', { code: err.errorCode, message: err.message })
                setPhase(sessionId ? 'ready' : 'idle')
                return
            }
            log.error('Send message failed', err)
            setError(
                sessionId
                    ? 'Failed to send message. The session may have expired.'
                    : 'Failed to start conversation. Is the backend running?'
            )
            setPhase(sessionId ? 'ready' : 'idle')
        } finally {
            setSending(false)
        }
    }, [
        sessionId,
        sending,
        conversationLoading,
        firstOutgoingNeedsStart,
        resumePreviousSessionId,
        addMessage,
        startStreaming,
        handleSessionExpired,
        onConversationCreated,
    ])

    const handleMenuItemClick = useCallback(
        (item, menuHandledBy) => {
            const { agentInput, displayText } = formatMenuSelectionMessage(item, menuHandledBy)
            handleSendMessage(agentInput, { displayText })
        },
        [handleSendMessage],
    )

    /**
     * Breadcrumb ancestor click: replay the cached level in-place (no backend call, no new turn).
     * On cache miss, fall back to a regular agent message so the user still navigates.
     */
    const handleBreadcrumbClick = useCallback((crumb) => {
        if (!crumb?.levelKey) return
        const cached = sessionId ? getCachedLevel(sessionId, crumb.levelKey) : null
        if (!cached) {
            handleSendMessage(`Go back to ${crumb.label}`)
            return
        }
        setMessages((prev) => {
            // Mutate the most recent AI menu bubble so the transcript isn't polluted with replayed levels.
            for (let i = prev.length - 1; i >= 0; i--) {
                const m = prev[i]
                if (m.role === 'ai' && m.payload?.subtype === 'menu') {
                    const next = prev.slice()
                    next[i] = { ...m, payload: cached }
                    return next
                }
            }
            return prev
        })
    }, [sessionId, handleSendMessage])

    const handleNewChat = useCallback(() => {
        log.info('New chat — reset state')
        if (sessionId) invalidateSession(sessionId)
        stopStreaming()
        setMessages([])
        setConversationId(null)
        setSessionId(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
        setResumePreviousSessionId(null)
        onNewChatParent?.()
    }, [sessionId, stopStreaming, onNewChatParent])

    const showEmptyState = messages.length === 0 && phase === 'idle' && !conversationLoading
    const showNewChatBtn = messages.length > 0 || conversationId != null || sessionId != null

    return (
        <div className="chat-window glass">
            <div className="chat-header">
                <div className="chat-header-left">
                    <div className="chat-avatar">
                        <SparkIcon size={20} fill="white" withCircle circleFill="#A56EFF" />
                    </div>
                    <div className="chat-header-info">
                        <h1>AI Agent</h1>
                        <span className="chat-status">
                            {conversationLoading
                                ? 'Loading…'
                                : phase === 'thinking'
                                  ? 'Processing...'
                                  : phase === 'expired'
                                    ? 'Session expired'
                                    : 'Powered by Camunda'}
                        </span>
                    </div>
                </div>
                {showNewChatBtn && (
                    <button className="new-chat-btn" onClick={handleNewChat} title="New conversation" aria-label="Start new conversation">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Chat
                    </button>
                )}
            </div>

            <div className="chat-messages" role="list" aria-label="Chat messages">
                {conversationLoading && (
                    <div className="conversation-loading-banner" aria-live="polite">
                        Loading conversation…
                    </div>
                )}

                {showEmptyState && (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <SparkIcon size={48} withCircle />
                        </div>
                        <h2>How can I help you today?</h2>
                        <p>
                            I'm an AI agent that can help you explore the catering catalog (categories, subcategories, and
                            products), submit IT-support tickets, and report facilities &amp; maintenance issues.
                            Set <code className="env-hint">VITE_DEFAULT_VISIT_ID</code> in{' '}
                            <code className="env-hint">.env</code> to anchor the chat to a specific visit context.
                        </p>
                        <div className="quick-prompts">
                            {QUICK_PROMPTS.map((prompt) => (
                                <button key={prompt} className="quick-prompt" onClick={() => handleSendMessage(prompt)}>
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        onMenuItemClick={handleMenuItemClick}
                        onBreadcrumbClick={handleBreadcrumbClick}
                    />
                ))}

                {phase === 'thinking' && (
                    <div aria-live="polite" aria-label="Agent is thinking">
                        <ThinkingIndicator />
                    </div>
                )}

                {error && (
                    <div className="error-banner" role="alert" aria-live="assertive">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        <span>{error}</span>
                        <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="chat-bottom">
                {(phase === 'idle' || phase === 'ready') && !conversationLoading && (
                    <ChatInput
                        ref={chatInputRef}
                        onSend={handleSendMessage}
                        disabled={sending}
                        placeholder={phase === 'idle' ? 'Type your message...' : 'Type a follow-up...'}
                    />
                )}

                {phase === 'thinking' && (
                    <div className="waiting-hint">
                        <span>Agent is working on your request...</span>
                    </div>
                )}

                {phase === 'expired' && (
                    <div className="waiting-hint">
                        <span>Session expired.</span>
                        <button className="inline-new-chat" onClick={handleNewChat}>Start a new conversation</button>
                    </div>
                )}
            </div>
        </div>
    )
}

ChatWindow.propTypes = {
    sidebarConversationId: PropTypes.string,
    onNewChat: PropTypes.func,
    onConversationCreated: PropTypes.func,
}
