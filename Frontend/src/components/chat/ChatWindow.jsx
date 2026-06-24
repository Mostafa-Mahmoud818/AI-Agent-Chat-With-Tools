/**
 * @file Main chat pane: orchestration lifecycle, SSE, menu cache + breadcrumbs, transcript.
 * @module components/chat/ChatWindow
 */

import {useCallback, useEffect, useRef, useState} from 'react'
import PropTypes from 'prop-types'
import {
    ApiError,
    createConversation,
    createResponseStream,
    fetchAllConversationTurns,
    sendReply,
    startOrchestration,
} from '../../services/api'
import {parseAgentMessage, turnsToMessages} from '../../utils/agentMessage.js'
import {formatMenuSelectionMessage} from '../../utils/menuSelection.js'
import {
    deriveBreadcrumb,
    parseSelectionSignal,
    rebuildChainFromMessages,
    reconcileChainWithResponse,
    updateChainOnSelection,
} from '../../utils/breadcrumb.js'
import {
    cacheLevel,
    getCachedLevel,
    invalidateSession,
    isRestartIntent,
    setActiveConversation,
} from '../../utils/menuCache.js'
import {
    getChatContextForStart,
    getVisitIdComposerPlaceholder,
    getVisitIdRequiredMessage,
    hasConfiguredVisitId,
    OTHER_VISIT_READONLY_MESSAGE,
} from '../../config/chatContext.js'
import {getAccessToken} from '../../auth/tokenStore.js'
import {isGuestChatAuth} from '../../config/chatAuth.js'
import {resolveVisitIdForCurrentUser} from '../../auth/visitResolution.js'
import {SSE_CONCURRENT_STREAMS_ERROR} from '../../services/api.js'
import {createLogger} from '../../utils/logger.js'
import MessageBubble from './MessageBubble.jsx'
import ChatInput from './ChatInput.jsx'
import ThinkingIndicator from './ThinkingIndicator.jsx'
import SparkIcon from '../ui/SparkIcon.jsx'
import './ChatWindow.css'

const log = createLogger('ChatWindow')

const guestMode = isGuestChatAuth(import.meta.env)

const QUICK_PROMPTS = [
    'What can you do?',
    'Show me the catering products menu',
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

export default function ChatWindow({
                                       sidebarConversationId = null,
                                       conversationReadOnly = false,
                                       onNewChat: onNewChatParent,
                                       onConversationCreated,
                                       onConversationActivity,
                                   }) {
    const [messages, setMessages] = useState([])
    const [conversationId, setConversationId] = useState(null)
    const [menuCacheConversationKey, setMenuCacheConversationKey] = useState(null)
    const [phase, setPhase] = useState('idle')
    const [error, setError] = useState(null)
    const [sending, setSending] = useState(false)
    const [conversationLoading, setConversationLoading] = useState(false)
    const [firstOutgoingNeedsStart, setFirstOutgoingNeedsStart] = useState(false)
    const messagesEndRef = useRef(null)
    const chatInputRef = useRef(null)
    const esRef = useRef(null)
    const selectionChainRef = useRef([])

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    useEffect(() => {
        log.debug('phase', phase)
    }, [phase])

    useEffect(() => {
        setActiveConversation(menuCacheConversationKey)
    }, [menuCacheConversationKey])

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
        setMessages((prev) => [...prev, {
            id: crypto.randomUUID(),
            role,
            text,
            displayText,
            timestamp: new Date(),
            handledBy,
            payload
        }])
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
        setMenuCacheConversationKey(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
        selectionChainRef.current = []
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
                const cacheKey = String(sidebarConversationId)
                selectionChainRef.current = rebuildChainFromMessages(loadedMessages)
                setMessages(loadedMessages)
                setConversationId(sidebarConversationId)
                setMenuCacheConversationKey(cacheKey)
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
                setMenuCacheConversationKey(null)
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

    const startStreaming = useCallback((convId, eventsCacheKey = null) => {
        stopStreaming()
        const es = createResponseStream(convId)
        esRef.current = es
        let terminalHandled = false
        const resolveCacheKey = () => eventsCacheKey ?? menuCacheConversationKey
        const notifySidebarActivity = () => {
            try {
                onConversationActivity?.(convId)
            } catch (err) {
                log.warn('onConversationActivity failed', err)
            }
        }
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
                    const {text, payload} = parseAgentMessage(data.message)
                    let finalPayload = payload
                    if (payload?.subtype === 'menu' && Array.isArray(payload.menuitems) && payload.menuitems.length > 0) {
                        const chain = reconcileChainWithResponse(selectionChainRef.current, payload.menuitems, data.handledBy)
                        selectionChainRef.current = chain
                        finalPayload = {...payload, breadcrumb: deriveBreadcrumb(data.handledBy, chain)}
                    }
                    applyCacheSideEffects(resolveCacheKey(), finalPayload)
                    addMessage('ai', text, data.handledBy, finalPayload)
                    notifySidebarActivity()
                    setPhase('ready')
                    setError(null)
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }
                if (data.status === 'error') {
                    notifySidebarActivity()
                    const msg = data.message || 'An error occurred while processing your request.'
                    if (msg === SSE_CONCURRENT_STREAMS_ERROR) {
                        return setReadyWithError('Too many open chat streams. Close other tabs and try again.')
                    }
                    return setReadyWithError(msg)
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

        es.onerror = () => {
            if (terminalHandled) return
            if (es.readyState === EventSource.CLOSED) setReadyWithError('Connection lost. Please try again.')
        }

        return es
    }, [addMessage, stopStreaming, handleSessionExpired, applyCacheSideEffects, menuCacheConversationKey, onConversationActivity])

    const reconcileTranscriptFromServer = useCallback(async (convId) => {
        const turns = await fetchAllConversationTurns(convId)
        const loadedMessages = turnsToMessages(turns)
        const cacheKey = String(convId)
        selectionChainRef.current = rebuildChainFromMessages(loadedMessages)
        setMessages(loadedMessages)
        setMenuCacheConversationKey(cacheKey)
        for (const m of loadedMessages) {
            if (m.role === 'ai') applyCacheSideEffects(cacheKey, m.payload)
        }
        setPhase('ready')
    }, [applyCacheSideEffects])

    /**
     * Opens SSE before POST so the client is subscribed before Camunda emits the terminal event.
     */
    const runOrchestrationRound = useCallback(async (convId, eventsCacheKey, postFn) => {
        startStreaming(convId, eventsCacheKey)
        try {
            await postFn()
        } catch (err) {
            stopStreaming()
            throw err
        }
    }, [startStreaming, stopStreaming])

    const visitIdConfigured = hasConfiguredVisitId()

    const handleSendMessage = useCallback(async (text, opts = {}) => {
        if (sending || conversationLoading) return
        if (conversationReadOnly) {
            setError(OTHER_VISIT_READONLY_MESSAGE)
            return
        }
        const needsOrchestrationStart = !conversationId || firstOutgoingNeedsStart
        if (needsOrchestrationStart && !hasConfiguredVisitId() && !isGuestChatAuth(import.meta.env)) {
            const token = getAccessToken()
            if (token) {
                try {
                    await resolveVisitIdForCurrentUser(import.meta.env, token)
                } catch (err) {
                    setError(err instanceof Error ? err.message : getVisitIdRequiredMessage(import.meta.env, guestMode))
                    setPhase(conversationId ? 'ready' : 'idle')
                    return
                }
            }
        }
        if (needsOrchestrationStart && !hasConfiguredVisitId()) {
            setError(getVisitIdRequiredMessage(import.meta.env, guestMode))
            setPhase(conversationId ? 'ready' : 'idle')
            return
        }
        const cacheKey = menuCacheConversationKey
        if (cacheKey && isRestartIntent(text)) {
            invalidateSession(cacheKey)
            selectionChainRef.current = []
        }
        setError(null)
        setSending(true)
        addMessage('user', text, {displayText: opts.displayText ?? null})
        setPhase('thinking')
        try {
            if (!conversationId) {
                const {conversationId: convId} = await createConversation(text, opts.displayText ?? null)
                setConversationId(convId)
                setMenuCacheConversationKey(convId)
                setFirstOutgoingNeedsStart(false)
                onConversationCreated?.()
                await runOrchestrationRound(
                    convId,
                    convId,
                    () => startOrchestration(convId, text, getChatContextForStart(), opts.displayText ?? null),
                )
            } else if (firstOutgoingNeedsStart) {
                const cacheKey = menuCacheConversationKey ?? conversationId
                await runOrchestrationRound(
                    conversationId,
                    cacheKey,
                    () => startOrchestration(conversationId, text, getChatContextForStart(), opts.displayText ?? null),
                )
                setFirstOutgoingNeedsStart(false)
            } else {
                const cacheKey = menuCacheConversationKey ?? conversationId
                await runOrchestrationRound(
                    conversationId,
                    cacheKey,
                    () => sendReply(conversationId, text, opts.displayText ?? null),
                )
            }
        } catch (err) {
            if (isSessionGone(err)) return handleSessionExpired()
            if (err instanceof ApiError && err.status === 400) {
                setError(err.message)
                setPhase(conversationId ? 'ready' : 'idle')
                return
            }
            if (err instanceof ApiError && err.status === 409 && conversationId) {
                try {
                    await reconcileTranscriptFromServer(conversationId)
                } catch (reconcileErr) {
                    log.warn('409 reconcile failed', reconcileErr)
                    setPhase('ready')
                }
                return
            }
            setError(conversationId ? 'Failed to send message. The session may have expired.' : 'Failed to start conversation. Is the backend running?')
            setPhase(conversationId ? 'ready' : 'idle')
        } finally {
            setSending(false)
        }
    }, [conversationId, conversationReadOnly, menuCacheConversationKey, sending, conversationLoading, firstOutgoingNeedsStart, addMessage, runOrchestrationRound, handleSessionExpired, onConversationCreated, reconcileTranscriptFromServer])

    const handleMenuItemClick = useCallback((item, menuHandledBy) => {
        if (item?.selectionSignal && typeof item.selectionSignal === 'string') {
            const signal = item.selectionSignal.trim()
            const parsed = parseSelectionSignal(signal)
            if (parsed) selectionChainRef.current = updateChainOnSelection(selectionChainRef.current, parsed)
            const displayLabel = item.label ?? item.name ?? null
            handleSendMessage(signal, {displayText: displayLabel})
            return
        }
        const {agentInput, displayText} = formatMenuSelectionMessage(item, menuHandledBy)
        const fallbackParsed = parseSelectionSignal(agentInput)
        if (fallbackParsed) selectionChainRef.current = updateChainOnSelection(selectionChainRef.current, fallbackParsed)
        handleSendMessage(agentInput, {displayText})
    }, [handleSendMessage])

    const handleBreadcrumbClick = useCallback((crumb) => {
        if (!crumb?.levelKey) return
        const cached = menuCacheConversationKey ? getCachedLevel(menuCacheConversationKey, crumb.levelKey) : null
        if (!cached) return handleSendMessage(`Go back to ${crumb.label}`)
        setMessages((prev) => {
            for (let i = prev.length - 1; i >= 0; i--) {
                const m = prev[i]
                if (m.role === 'ai' && m.payload?.subtype === 'menu') {
                    const next = prev.slice()
                    next[i] = {...m, payload: cached}
                    return next
                }
            }
            return prev
        })
    }, [menuCacheConversationKey, handleSendMessage])

    const handleNewChat = useCallback(() => {
        if (menuCacheConversationKey) invalidateSession(menuCacheConversationKey)
        stopStreaming()
        setMessages([])
        setConversationId(null)
        setMenuCacheConversationKey(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
        selectionChainRef.current = []
        onNewChatParent?.()
    }, [menuCacheConversationKey, stopStreaming, onNewChatParent])

    const showEmptyState = messages.length === 0 && phase === 'idle' && !conversationLoading
    const showNewChatBtn = messages.length > 0 || conversationId != null || menuCacheConversationKey != null

    return (
        <div className="chat-window glass">
            <div className="chat-header">
                <div className="chat-header-left">
                    <div className="chat-avatar">
                        <SparkIcon size={20} fill="white" withCircle circleFill="#A56EFF"/>
                    </div>
                    <div className="chat-header-info">
                        <h1>AI Agent</h1>
                        <span className="chat-status">
                            {conversationLoading ? 'Loading…' : phase === 'thinking' ? 'Processing...' : phase === 'expired' ? 'Session expired' : 'Powered by Camunda'}
                        </span>
                    </div>
                </div>
                {showNewChatBtn && (
                    <button className="new-chat-btn" onClick={handleNewChat} title="New conversation"
                            aria-label="Start new conversation">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                        New Chat
                    </button>
                )}
            </div>

            <div className="chat-messages" role="list" aria-label="Chat messages">
                {conversationLoading &&
                    <div className="conversation-loading-banner" aria-live="polite">Loading conversation…</div>}
                {showEmptyState && (
                    <div className="empty-state">
                        <div className="empty-icon"><SparkIcon size={48} withCircle/></div>
                        <h2>How can I help you today?</h2>
                        <p>Start with our Visitor Experience assistant for greetings and capabilities, then explore the
                            catering catalog, submit IT-support tickets, or report facilities &amp; maintenance
                            issues.</p>
                        {!visitIdConfigured && (
                            <div className="visit-id-hint" role="status">
                                {getVisitIdRequiredMessage(import.meta.env, guestMode)}
                            </div>
                        )}
                        <div className="quick-prompts">
                            {QUICK_PROMPTS.map((prompt) => (
                                <button
                                    key={prompt}
                                    className="quick-prompt"
                                    disabled={!visitIdConfigured || sending || conversationReadOnly}
                                    onClick={() => handleSendMessage(prompt)}
                                >
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((msg) => (
                    <MessageBubble key={msg.id} message={msg} onMenuItemClick={handleMenuItemClick}
                                   onBreadcrumbClick={handleBreadcrumbClick}/>
                ))}
                {phase === 'thinking' &&
                    <div aria-live="polite" aria-label="Agent is thinking"><ThinkingIndicator/></div>}
                {error && (
                    <div className="error-banner" role="alert" aria-live="assertive">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" aria-hidden="true">
                            <circle cx="12" cy="12" r="10"/>
                            <line x1="12" y1="8" x2="12" y2="12"/>
                            <line x1="12" y1="16" x2="12.01" y2="16"/>
                        </svg>
                        <span>{error}</span>
                        <button className="error-dismiss" onClick={() => setError(null)} aria-label="Dismiss error">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" aria-hidden="true">
                                <line x1="18" y1="6" x2="6" y2="18"/>
                                <line x1="6" y1="6" x2="18" y2="18"/>
                            </svg>
                        </button>
                    </div>
                )}
                <div ref={messagesEndRef}/>
            </div>

            <div className="chat-bottom">
                {conversationReadOnly && !conversationLoading && (
                    <div className="waiting-hint" role="status" aria-live="polite">
                        <span>{OTHER_VISIT_READONLY_MESSAGE}</span>
                    </div>
                )}
                {!conversationReadOnly && (phase === 'idle' || phase === 'ready') && !conversationLoading && (
                    <ChatInput
                        ref={chatInputRef}
                        onSend={handleSendMessage}
                        disabled={sending || (visitIdConfigured ? false : (!conversationId || firstOutgoingNeedsStart))}
                        placeholder={
                            !visitIdConfigured && (!conversationId || firstOutgoingNeedsStart)
                                ? getVisitIdComposerPlaceholder(import.meta.env, guestMode)
                                : phase === 'idle'
                                    ? 'Type your message...'
                                    : 'Type a follow-up...'
                        }
                    />
                )}
                {phase === 'thinking' &&
                    <div className="waiting-hint"><span>Agent is working on your request...</span></div>}
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
    conversationReadOnly: PropTypes.bool,
    onNewChat: PropTypes.func,
    onConversationCreated: PropTypes.func,
    onConversationActivity: PropTypes.func,
}
