/**
 * @file Main chat pane: orchestration lifecycle, SSE, menu cache + breadcrumbs, transcript.
 * @module components/chat/ChatWindow
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import PropTypes from 'prop-types'
import {
    createConversation,
    startOrchestration,
    sendReply,
    createResponseStream,
    fetchAllConversationTurns,
    ApiError,
} from '../../services/api'
import { parseAgentMessage, turnsToMessages } from '../../utils/agentMessage.js'
import { formatMenuSelectionMessage } from '../../utils/menuSelection.js'
import {
    cacheLevel,
    getCachedLevel,
    invalidateSession,
    isRestartIntent,
    setActiveSession,
} from '../../utils/menuCache.js'
import { createLogger } from '../../utils/logger.js'
import MessageBubble from './MessageBubble.jsx'
import ChatInput from './ChatInput.jsx'
import ThinkingIndicator from './ThinkingIndicator.jsx'
import SparkIcon from '../ui/SparkIcon.jsx'
import './ChatWindow.css'

const log = createLogger('ChatWindow')

const QUICK_PROMPTS = [
    'Show me the catering products menu',
    'Show me the catering product categories',
    'Create a support ticket for my laptop issue',
    'I need help with my VPN connection',
    'Submit a facilities & maintenance request',
    'The AC in meeting room 3 is not working',
    'I need cleaning scheduled for my office',
]

function isSessionGone(err) {
    return err instanceof ApiError &&
        (err.errorCode === 'session_expired' || err.status === 410)
}

function menuCacheKeyFromTurns(conversationId, turns) {
    const last = turns?.length ? turns[turns.length - 1] : null
    const sid = last?.sessionId != null ? String(last.sessionId) : null
    return sid || String(conversationId)
}

export default function ChatWindow({
    sidebarConversationId = null,
    onNewChat: onNewChatParent,
    onConversationCreated,
    onConversationActivity,
}) {
    const [messages, setMessages] = useState([])
    const [conversationId, setConversationId] = useState(null)
    const [menuCacheSessionKey, setMenuCacheSessionKey] = useState(null)
    const [phase, setPhase] = useState('idle')
    const [error, setError] = useState(null)
    const [sending, setSending] = useState(false)
    const [conversationLoading, setConversationLoading] = useState(false)
    const [firstOutgoingNeedsStart, setFirstOutgoingNeedsStart] = useState(false)
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

    useEffect(() => {
        setActiveSession(menuCacheSessionKey)
    }, [menuCacheSessionKey])

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

    const applyCacheSideEffects = useCallback((cacheKey, payload) => {
        if (!cacheKey || !payload) return
        if (payload.subtype === 'order_confirmation') {
            invalidateSession(cacheKey)
            return
        }
        if (payload.subtype === 'menu' && Array.isArray(payload.breadcrumb) && payload.breadcrumb.length > 0) {
            const last = payload.breadcrumb[payload.breadcrumb.length - 1]
            if (last?.levelKey) cacheLevel(cacheKey, last.levelKey, payload)
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

    useEffect(() => {
        if (sidebarConversationId != null) return
        stopStreaming()
        setMessages([])
        setConversationId(null)
        setMenuCacheSessionKey(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
    }, [sidebarConversationId, stopStreaming])

    useEffect(() => {
        if (!sidebarConversationId) return undefined
        let cancelled = false
        async function load() {
            stopStreaming()
            setConversationLoading(true)
            setError(null)
            setFirstOutgoingNeedsStart(false)
            try {
                const turns = await fetchAllConversationTurns(sidebarConversationId)
                if (cancelled) return
                const loadedMessages = turnsToMessages(turns)
                const cacheKey = menuCacheKeyFromTurns(sidebarConversationId, turns)
                setMessages(loadedMessages)
                setConversationId(sidebarConversationId)
                setMenuCacheSessionKey(cacheKey)
                for (const m of loadedMessages) if (m.role === 'ai') applyCacheSideEffects(cacheKey, m.payload)
                setFirstOutgoingNeedsStart((turns?.length ?? 0) === 0)
                setPhase(turns.length > 0 ? 'ready' : 'idle')
                setTimeout(() => chatInputRef.current?.focus(), 50)
            } catch (err) {
                if (cancelled) return
                log.error('Failed to load conversation', err)
                setError(err instanceof ApiError ? err.message : 'Failed to load conversation')
                setMessages([])
                setConversationId(null)
                setMenuCacheSessionKey(null)
                setPhase('idle')
            } finally {
                if (!cancelled) setConversationLoading(false)
            }
        }
        load()
        return () => { cancelled = true }
    }, [sidebarConversationId, stopStreaming, applyCacheSideEffects])

    const startStreaming = useCallback((convId, eventsCacheKey = null) => {
        stopStreaming()
        const es = createResponseStream(convId)
        esRef.current = es
        let terminalHandled = false
        const resolveCacheKey = () => eventsCacheKey ?? menuCacheSessionKey
        const notifySidebarActivity = () => { try { onConversationActivity?.(convId) } catch (err) { log.warn('onConversationActivity failed', err) } }
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
                if (data.status === 'processing') return setPhase('thinking')
                if (data.status === 'ready' && data.message) {
                    terminalHandled = true
                    stopStreaming()
                    const { text, payload } = parseAgentMessage(data.message)
                    applyCacheSideEffects(resolveCacheKey(), payload)
                    addMessage('ai', text, data.handledBy, payload)
                    notifySidebarActivity()
                    setPhase('ready')
                    setError(null)
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }
                if (data.status === 'error') {
                    notifySidebarActivity()
                    return setReadyWithError(data.message || 'An error occurred while processing your request.')
                }
                if (data.status === 'expired') {
                    terminalHandled = true
                    stopStreaming()
                    handleSessionExpired()
                }
            } catch (err) {
                log.error('SSE message parse error', err)
            }
        }

        es.addEventListener('error', (event) => {
            if (!event.data) return
            try {
                const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
                if (data.status === 'expired') {
                    terminalHandled = true
                    stopStreaming()
                    handleSessionExpired()
                    return
                }
                if (data.status === 'error' || data.message) setReadyWithError(data.message || 'An error occurred.')
            } catch {}
        })

        es.onerror = () => {
            if (terminalHandled) return
            if (es.readyState === EventSource.CLOSED) setReadyWithError('Connection lost. Please try again.')
        }
    }, [addMessage, stopStreaming, handleSessionExpired, applyCacheSideEffects, menuCacheSessionKey, onConversationActivity])

    const handleSendMessage = useCallback(async (text, opts = {}) => {
        if (sending || conversationLoading) return
        const cacheKey = menuCacheSessionKey
        if (cacheKey && isRestartIntent(text)) invalidateSession(cacheKey)
        setError(null)
        setSending(true)
        addMessage('user', text, { displayText: opts.displayText ?? null })
        setPhase('thinking')
        try {
            if (!conversationId) {
                const { conversationId: convId } = await createConversation(text, opts.displayText ?? null)
                setConversationId(convId)
                setMenuCacheSessionKey(convId)
                setFirstOutgoingNeedsStart(false)
                onConversationCreated?.()
                await startOrchestration(convId, text, undefined, opts.displayText ?? null)
                startStreaming(convId, convId)
            } else if (firstOutgoingNeedsStart) {
                await startOrchestration(conversationId, text, undefined, opts.displayText ?? null)
                setFirstOutgoingNeedsStart(false)
                startStreaming(conversationId, menuCacheSessionKey ?? conversationId)
            } else {
                await sendReply(conversationId, text, opts.displayText ?? null)
                startStreaming(conversationId, menuCacheSessionKey ?? conversationId)
            }
        } catch (err) {
            if (isSessionGone(err)) return handleSessionExpired()
            if (err instanceof ApiError && err.status === 400) {
                setError(err.message)
                setPhase(conversationId ? 'ready' : 'idle')
                return
            }
            if (err instanceof ApiError && err.status === 409) {
                setPhase(conversationId ? 'ready' : 'idle')
                return
            }
            setError(conversationId ? 'Failed to send message. The session may have expired.' : 'Failed to start conversation. Is the backend running?')
            setPhase(conversationId ? 'ready' : 'idle')
        } finally {
            setSending(false)
        }
    }, [conversationId, menuCacheSessionKey, sending, conversationLoading, firstOutgoingNeedsStart, addMessage, startStreaming, handleSessionExpired, onConversationCreated])

    const handleMenuItemClick = useCallback((item, menuHandledBy) => {
        if (item?.selectionSignal && typeof item.selectionSignal === 'string') {
            const displayLabel = item.label ?? item.name ?? null
            handleSendMessage(item.selectionSignal.trim(), { displayText: displayLabel })
            return
        }
        const { agentInput, displayText } = formatMenuSelectionMessage(item, menuHandledBy)
        handleSendMessage(agentInput, { displayText })
    }, [handleSendMessage])

    const handleBreadcrumbClick = useCallback((crumb) => {
        if (!crumb?.levelKey) return
        const cached = menuCacheSessionKey ? getCachedLevel(menuCacheSessionKey, crumb.levelKey) : null
        if (!cached) return handleSendMessage(`Go back to ${crumb.label}`)
        setMessages((prev) => {
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
    }, [menuCacheSessionKey, handleSendMessage])

    const handleNewChat = useCallback(() => {
        if (menuCacheSessionKey) invalidateSession(menuCacheSessionKey)
        stopStreaming()
        setMessages([])
        setConversationId(null)
        setMenuCacheSessionKey(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
        onNewChatParent?.()
    }, [menuCacheSessionKey, stopStreaming, onNewChatParent])

    const showEmptyState = messages.length === 0 && phase === 'idle' && !conversationLoading
    const showNewChatBtn = messages.length > 0 || conversationId != null || menuCacheSessionKey != null

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
                            {conversationLoading ? 'Loading…' : phase === 'thinking' ? 'Processing...' : phase === 'expired' ? 'Session expired' : 'Powered by Camunda'}
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
                {conversationLoading && <div className="conversation-loading-banner" aria-live="polite">Loading conversation…</div>}
                {showEmptyState && (
                    <div className="empty-state">
                        <div className="empty-icon"><SparkIcon size={48} withCircle /></div>
                        <h2>How can I help you today?</h2>
                        <p>I'm an AI agent that can help you explore the catering catalog (categories, subcategories, and products), submit IT-support tickets, and report facilities &amp; maintenance issues.</p>
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
                    <MessageBubble key={msg.id} message={msg} onMenuItemClick={handleMenuItemClick} onBreadcrumbClick={handleBreadcrumbClick} />
                ))}
                {phase === 'thinking' && <div aria-live="polite" aria-label="Agent is thinking"><ThinkingIndicator /></div>}
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
                    <ChatInput ref={chatInputRef} onSend={handleSendMessage} disabled={sending} placeholder={phase === 'idle' ? 'Type your message...' : 'Type a follow-up...'} />
                )}
                {phase === 'thinking' && <div className="waiting-hint"><span>Agent is working on your request...</span></div>}
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
    onConversationActivity: PropTypes.func,
}
