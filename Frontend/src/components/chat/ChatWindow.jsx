/**
 * @file Main chat pane: orchestration lifecycle, SSE, transcript.
 * @module components/chat/ChatWindow
 */

import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import PropTypes from 'prop-types'
import {
    ApiError,
    createConversation,
    createResponseStream,
    fetchAllConversationTurns,
    sendReply,
    SSE_CONCURRENT_STREAMS_ERROR,
    startOrchestration,
} from '../../services/api'
import {parseAgentMessage, turnsToMessages} from '../../utils/agentMessage.js'
import {formatMenuSelectionMessage} from '../../utils/menuSelection.js'
import {
    getStudentIdComposerPlaceholder,
    getStudentIdRequiredMessage,
    getVisitIdComposerPlaceholder,
    getVisitIdRequiredMessage,
} from '../../config/chatContext.js'
import {
    getChatContextForStart,
    getOtherContextComposerPlaceholder,
    getOtherContextReadonlyMessage,
    hasConfiguredActivePersonaContext,
    PERSONA_STUDENT,
    PERSONA_VISIT,
    resolveActivePersona,
} from '../../config/personaSession.js'
import {getAccessToken} from '../../auth/tokenStore.js'
import {tryResolveVisitIdForCurrentUser} from '../../auth/visitResolution.js'
import {tryResolveStudentIdForCurrentUser} from '../../auth/studentResolution.js'
import {createLogger} from '../../utils/logger.js'
import MessageBubble from './MessageBubble.jsx'
import ChatInput from './ChatInput.jsx'
import ThinkingIndicator from './ThinkingIndicator.jsx'
import SparkIcon from '../ui/SparkIcon.jsx'
import './ChatWindow.css'

const log = createLogger('ChatWindow')

const VISIT_PROMPT_GROUPS = [
    {label: 'Start', prompts: ['What can you do?']},
    {label: 'Catering', prompts: ['Show me the catering products menu']},
    {
        label: 'IT Support',
        prompts: [
            'Create a support ticket for my laptop issue',
            'I need help with my VPN connection',
        ],
    },
    {
        label: 'Facilities',
        prompts: [
            'Submit a facilities & maintenance request',
            'The AC in meeting room 3 is not working',
            'I need cleaning scheduled for my office',
        ],
    },
]

const STUDENT_PROMPT_GROUPS = [
    {label: 'Start', prompts: ['What can you do?']},
    {
        label: 'Absence',
        prompts: [
            'I need to submit an absence',
            'Help me request an excused absence',
        ],
    },
    {
        label: 'Error Banner',
        prompts: [
            'I got a Banner registration error',
            "I can't register - Banner error",
        ],
    },
]

function isSessionGone(err) {
    return err instanceof ApiError &&
        (err.errorCode === 'session_expired' || err.status === 410)
}

/**
 * Derive composer mode from the latest AI message payload (live or history resume).
 * Payload-less non-system AI (parsed `subtype: none` → `payload: null`) clears attach/date mode.
 * System-origin turns are skipped so a status update does not drop an owed date/attach.
 *
 * @param {Array<{ role: string, system?: boolean, payload?: object|null, handledBy?: string|null }>} messages
 * @returns {{
 *   mode: 'default'|'attachment_request'|'date_request',
 *   dateConstraint: object|null,
 *   attachmentHandledBy: string|null,
 * }}
 */
function nearestAiHandledBy(messages, fromIndexInclusive) {
    for (let i = fromIndexInclusive; i >= 0; i--) {
        const m = messages[i]
        if (m?.role === 'ai' && m.system !== true && m.handledBy) return m.handledBy
    }
    return null
}

export function deriveComposerModeFromMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) {
        return {mode: 'default', dateConstraint: null, attachmentHandledBy: null}
    }
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i]
        if (m?.role !== 'ai') continue
        if (m.system === true) continue
        if (!m.payload?.subtype) {
            return {mode: 'default', dateConstraint: null, attachmentHandledBy: null}
        }
        const subtype = m.payload.subtype
        if (subtype === 'attachment_request') {
            return {
                mode: 'attachment_request',
                dateConstraint: null,
                attachmentHandledBy: m.handledBy ?? nearestAiHandledBy(messages, i - 1),
            }
        }
        if (subtype === 'date_request') {
            return {
                mode: 'date_request',
                dateConstraint: m.payload.dateConstraint ?? null,
                attachmentHandledBy: null,
            }
        }
        return {mode: 'default', dateConstraint: null, attachmentHandledBy: null}
    }
    return {mode: 'default', dateConstraint: null, attachmentHandledBy: null}
}

export default function ChatWindow({
    sidebarConversationId = null,
    conversationReadOnly = false,
    selectedConversation = null,
    headerAccessory = null,
    onNewChat: onNewChatParent,
    onConversationCreated,
    onConversationActivity,
    onBusyChange,
}) {
    const [messages, setMessages] = useState([])
    const [conversationId, setConversationId] = useState(null)
    const [phase, setPhase] = useState('idle')
    const [error, setError] = useState(null)
    const [sending, setSending] = useState(false)
    const [conversationLoading, setConversationLoading] = useState(false)
    const [firstOutgoingNeedsStart, setFirstOutgoingNeedsStart] = useState(false)
    const messagesEndRef = useRef(null)
    const chatInputRef = useRef(null)
    const esRef = useRef(null)
    /** Synchronous send lock — survives until terminal/reconcile, not POST resolution. */
    const sendLockRef = useRef(false)
    /** Bumped on New Chat / conversation switch so late async cannot mutate the wrong pane. */
    const generationRef = useRef(0)

    const activePersona = resolveActivePersona()
    const contextConfigured = hasConfiguredActivePersonaContext()
    const composerDerived = useMemo(() => deriveComposerModeFromMessages(messages), [messages])
    const menuInteractionBusy = sending || phase === 'thinking'

    useEffect(() => {
        onBusyChange?.(menuInteractionBusy)
    }, [menuInteractionBusy, onBusyChange])

    const bumpGeneration = useCallback(() => {
        generationRef.current += 1
        return generationRef.current
    }, [])

    const releaseSendLock = useCallback(() => {
        sendLockRef.current = false
        setSending(false)
    }, [])

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({behavior: 'smooth'})
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    useEffect(() => {
        log.debug('phase', phase)
    }, [phase])

    const addMessage = useCallback((role, text, optsOrHandledBy = null, payload = null) => {
        const opts = optsOrHandledBy && typeof optsOrHandledBy === 'object' ? optsOrHandledBy : null
        const handledBy = opts ? null : optsOrHandledBy
        const displayText = opts?.displayText ?? null
        const id = opts?.id ?? crypto.randomUUID()
        const failed = opts?.failed === true
        setMessages((prev) => [...prev, {
            id,
            role,
            text,
            displayText,
            timestamp: new Date(),
            handledBy: opts ? (opts.handledBy ?? null) : handledBy,
            payload,
            failed: failed || undefined,
        }])
        return id
    }, [])

    const stopStreaming = useCallback(() => {
        if (esRef.current) {
            esRef.current.close()
            esRef.current = null
        }
    }, [])

    useEffect(() => {
        return () => {
            // Invalidate this fiber so a POST that resolves after remount cannot open SSE.
            bumpGeneration()
            stopStreaming()
        }
    }, [bumpGeneration, stopStreaming])

    const handleSessionExpired = useCallback(() => {
        stopStreaming()
        setPhase('expired')
        releaseSendLock()
        addMessage('system', 'Session has expired due to inactivity. Please start a new conversation.')
    }, [stopStreaming, addMessage, releaseSendLock])

    useEffect(() => {
        if (sidebarConversationId != null) return
        bumpGeneration()
        stopStreaming()
        sendLockRef.current = false
        setMessages([])
        setConversationId(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
    }, [sidebarConversationId, stopStreaming, bumpGeneration])

    useEffect(() => {
        if (!sidebarConversationId) return undefined
        const gen = bumpGeneration()
        let cancelled = false

        async function load() {
            stopStreaming()
            sendLockRef.current = false
            setSending(false)
            setConversationLoading(true)
            setError(null)
            setFirstOutgoingNeedsStart(false)
            try {
                const turns = await fetchAllConversationTurns(sidebarConversationId)
                if (cancelled || generationRef.current !== gen) return
                const loadedMessages = turnsToMessages(turns)
                setMessages(loadedMessages)
                setConversationId(sidebarConversationId)
                setFirstOutgoingNeedsStart((turns?.length ?? 0) === 0)
                setPhase(turns.length > 0 ? 'ready' : 'idle')
                setTimeout(() => chatInputRef.current?.focus(), 50)
            } catch (err) {
                if (cancelled || generationRef.current !== gen) return
                log.error('Failed to load conversation', err)
                setError(err instanceof ApiError ? err.message : 'Failed to load conversation')
                setMessages([])
                setConversationId(null)
                setPhase('idle')
            } finally {
                if (!cancelled && generationRef.current === gen) setConversationLoading(false)
            }
        }

        load()
        return () => {
            cancelled = true
        }
    }, [sidebarConversationId, stopStreaming, bumpGeneration])

    const startStreaming = useCallback((convId, streamGen) => {
        stopStreaming()
        const es = createResponseStream(convId)
        esRef.current = es
        let terminalHandled = false
        const stillCurrent = () => generationRef.current === streamGen

        const notifySidebarActivity = () => {
            try {
                onConversationActivity?.(convId)
            } catch (err) {
                log.warn('onConversationActivity failed', err)
            }
        }
        const setReadyWithError = (message) => {
            if (!stillCurrent()) return
            terminalHandled = true
            stopStreaming()
            setError(message)
            setPhase('ready')
            releaseSendLock()
            setTimeout(() => chatInputRef.current?.focus(), 100)
        }

        const recoverMissedReply = (waitingCopy, failedCopy) => {
            if (!stillCurrent()) return
            setError(waitingCopy)
            setPhase('ready')
            releaseSendLock()
            fetchAllConversationTurns(convId)
                .then((turns) => {
                    if (generationRef.current !== streamGen) return
                    setMessages(turnsToMessages(turns))
                    setError(null)
                })
                .catch((reconcileErr) => {
                    log.warn('missed-reply reconcile failed', reconcileErr)
                    if (generationRef.current !== streamGen) return
                    setError(failedCopy)
                })
                .finally(() => {
                    if (generationRef.current === streamGen) {
                        setTimeout(() => chatInputRef.current?.focus(), 100)
                    }
                })
        }

        es.onmessage = (event) => {
            if (terminalHandled) return
            if (!stillCurrent()) return
            try {
                const data = JSON.parse(event.data)
                if (data.status === 'processing') return setPhase('thinking')
                if (data.status === 'ready') {
                    terminalHandled = true
                    stopStreaming()
                    if (!stillCurrent()) return
                    if (!data.message) {
                        log.warn('SSE terminal "ready" with empty message — reconciling transcript')
                        recoverMissedReply(
                            'The assistant reply did not arrive. Refreshing the conversation…',
                            'Connection closed before a reply arrived. Please try again.',
                        )
                        return
                    }
                    const {text, payload} = parseAgentMessage(data.message)
                    addMessage('ai', text, data.handledBy, payload)
                    notifySidebarActivity()
                    setPhase('ready')
                    setError(null)
                    releaseSendLock()
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }
                if (data.status === 'error') {
                    notifySidebarActivity()
                    const msg = data.message || 'An error occurred while processing your request.'
                    if (msg === SSE_CONCURRENT_STREAMS_ERROR) {
                        return setReadyWithError('Too many open chat streams. Close other tabs and try again.')
                    }
                    return setReadyWithError(msg || 'Something went wrong. Please try again.')
                }
                if (data.status === 'expired') {
                    terminalHandled = true
                    stopStreaming()
                    if (!stillCurrent()) return
                    handleSessionExpired()
                    return
                }
                log.warn('Unhandled SSE status', data?.status)
            } catch (err) {
                log.error('SSE message parse error', err)
            }
        }

        es.onclosedWithoutTerminal = () => {
            if (terminalHandled) return
            if (!stillCurrent()) return
            terminalHandled = true
            stopStreaming()
            recoverMissedReply(
                'The assistant reply did not arrive. Refreshing the conversation…',
                'Connection closed before a reply arrived. Please try again.',
            )
        }

        es.onerror = () => {
            if (terminalHandled) return
            if (!stillCurrent()) return
            if (es.readyState === 2 /* EventSource.CLOSED */) {
                setReadyWithError('Connection lost. Please try again.')
            }
        }

        return es
    }, [addMessage, stopStreaming, handleSessionExpired, onConversationActivity, releaseSendLock])

    const reconcileTranscriptFromServer = useCallback(async (convId, expectedGen) => {
        const turns = await fetchAllConversationTurns(convId)
        if (expectedGen != null && generationRef.current !== expectedGen) return
        const loadedMessages = turnsToMessages(turns)
        setMessages(loadedMessages)
        setPhase('ready')
        releaseSendLock()
    }, [releaseSendLock])

    const runOrchestrationRound = useCallback(async (convId, postFn, streamGen) => {
        // POST first so discardLastResponse clears stale READY before subscribe (no previous-round replay).
        try {
            await postFn()
        } catch (err) {
            stopStreaming()
            throw err
        }
        if (generationRef.current !== streamGen) return false
        startStreaming(convId, streamGen)
        return true
    }, [startStreaming, stopStreaming])

    const contextRequiredMessage = activePersona === PERSONA_STUDENT
        ? getStudentIdRequiredMessage()
        : getVisitIdRequiredMessage()

    const contextComposerPlaceholder = activePersona === PERSONA_STUDENT
        ? getStudentIdComposerPlaceholder()
        : getVisitIdComposerPlaceholder()

    const handleSendMessage = useCallback(async (text, opts = {}) => {
        if (sendLockRef.current || sending || conversationLoading) return false
        // Take the lock synchronously, before any await below — otherwise a second call arriving
        // during the persona-context resolution awaits would still see the lock/`sending` both false
        // and proceed concurrently (the exact double-dispatch this lock exists to prevent).
        const streamGen = generationRef.current
        sendLockRef.current = true
        if (conversationReadOnly) {
            releaseSendLock()
            setError(getOtherContextReadonlyMessage(selectedConversation))
            return false
        }
        const needsOrchestrationStart = !conversationId || firstOutgoingNeedsStart
        if (needsOrchestrationStart && !hasConfiguredActivePersonaContext()) {
            const token = getAccessToken()
            const persona = resolveActivePersona()
            if (token && persona === PERSONA_VISIT) {
                try {
                    await tryResolveVisitIdForCurrentUser(import.meta.env, token, {attempts: 1, delayMs: 0})
                } catch (err) {
                    if (generationRef.current === streamGen) releaseSendLock()
                    setError(err instanceof Error ? err.message : contextRequiredMessage)
                    setPhase(conversationId ? 'ready' : 'idle')
                    return false
                }
            } else if (token && persona === PERSONA_STUDENT) {
                await tryResolveStudentIdForCurrentUser(import.meta.env, token)
            }
        }
        if (needsOrchestrationStart && !hasConfiguredActivePersonaContext()) {
            if (generationRef.current === streamGen) releaseSendLock()
            setError(contextRequiredMessage)
            setPhase(conversationId ? 'ready' : 'idle')
            return false
        }

        setError(null)
        setSending(true)
        const optimisticId = crypto.randomUUID()
        addMessage('user', text, {displayText: opts.displayText ?? null, id: optimisticId})
        setPhase('thinking')
        try {
            let streamed = false
            if (!conversationId) {
                const {conversationId: convId} = await createConversation(text, opts.displayText ?? null)
                if (generationRef.current !== streamGen) return false
                setConversationId(convId)
                // Until start succeeds, further sends must still call /start (not /user-messages).
                setFirstOutgoingNeedsStart(true)
                onConversationCreated?.()
                streamed = await runOrchestrationRound(
                    convId,
                    () => startOrchestration(convId, text, getChatContextForStart(), opts.displayText ?? null),
                    streamGen,
                )
                if (generationRef.current === streamGen) {
                    setFirstOutgoingNeedsStart(false)
                }
            } else if (firstOutgoingNeedsStart) {
                streamed = await runOrchestrationRound(
                    conversationId,
                    () => startOrchestration(conversationId, text, getChatContextForStart(), opts.displayText ?? null),
                    streamGen,
                )
                if (generationRef.current === streamGen) {
                    setFirstOutgoingNeedsStart(false)
                }
            } else {
                streamed = await runOrchestrationRound(
                    conversationId,
                    () => sendReply(conversationId, text, opts.displayText ?? null),
                    streamGen,
                )
            }
            return streamed === true && generationRef.current === streamGen
        } catch (err) {
            if (generationRef.current === streamGen) {
                setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
            }
            if (isSessionGone(err)) {
                handleSessionExpired()
                return false
            }
            if (generationRef.current !== streamGen) {
                // A newer round has already taken over (e.g. New Chat mid-flight bumped the
                // generation without this round's own lock/phase ever being released). This stale
                // round's failure must not release the lock or touch phase/error for the round now
                // actually in progress.
                return false
            }
            releaseSendLock()
            if (err instanceof ApiError && (err.status === 400 || err.status === 422)) {
                setError(err.message)
                setPhase(conversationId ? 'ready' : 'idle')
                return false
            }
            if (err instanceof ApiError && err.status === 403) {
                const msg = err.message?.includes('START_FAILED')
                    ? err.message.replace(/^START_FAILED:\s*/i, '')
                    : (err.message || 'This visit or student record is not available for this account.')
                setError(msg)
                setPhase(conversationId ? 'ready' : 'idle')
                return false
            }
            if (err instanceof ApiError && err.status === 409 && conversationId) {
                try {
                    await reconcileTranscriptFromServer(conversationId, streamGen)
                } catch (reconcileErr) {
                    log.warn('409 reconcile failed', reconcileErr)
                    if (generationRef.current === streamGen) setPhase('ready')
                }
                return false
            }
            if (err instanceof ApiError && (err.status === 429 || err.status === 503)) {
                setError(err.message || (err.status === 429
                    ? 'Too many requests. Please wait a moment and try again.'
                    : 'The assistant is temporarily unavailable. Please try again.'))
                setPhase(conversationId ? 'ready' : 'idle')
                return false
            }
            setError(conversationId ? 'Failed to send message. The session may have expired.' : 'Failed to start conversation. Is the backend running?')
            setPhase(conversationId ? 'ready' : 'idle')
            return false
        }
    }, [
        conversationId,
        conversationReadOnly,
        selectedConversation,
        sending,
        conversationLoading,
        firstOutgoingNeedsStart,
        addMessage,
        runOrchestrationRound,
        handleSessionExpired,
        onConversationCreated,
        reconcileTranscriptFromServer,
        contextRequiredMessage,
        releaseSendLock,
    ])

    const handleMenuItemClick = useCallback((item, menuHandledBy) => {
        if (menuInteractionBusy) return
        if (item?.selectionSignal && typeof item.selectionSignal === 'string') {
            const signal = item.selectionSignal.trim()
            const displayLabel = item.label ?? item.name ?? null
            handleSendMessage(signal, {displayText: displayLabel})
            return
        }
        const {agentInput, displayText} = formatMenuSelectionMessage(item, menuHandledBy)
        handleSendMessage(agentInput, {displayText})
    }, [handleSendMessage, menuInteractionBusy])

    const handleNewChat = useCallback(() => {
        bumpGeneration()
        stopStreaming()
        sendLockRef.current = false
        setMessages([])
        setConversationId(null)
        setPhase('idle')
        setError(null)
        setSending(false)
        setConversationLoading(false)
        setFirstOutgoingNeedsStart(false)
        onNewChatParent?.()
    }, [stopStreaming, onNewChatParent, bumpGeneration])

    const showEmptyState = messages.length === 0 && phase === 'idle' && !conversationLoading
    const showNewChatBtn = messages.length > 0 || conversationId != null
    const promptGroups = activePersona === PERSONA_STUDENT ? STUDENT_PROMPT_GROUPS : VISIT_PROMPT_GROUPS
    const statusTone = conversationLoading
        ? 'loading'
        : phase === 'thinking'
            ? 'busy'
            : phase === 'expired'
                ? 'expired'
                : 'ready'
    const emptyBody = activePersona === PERSONA_STUDENT
        ? 'Ask about capabilities, submit a new absence request, or report a Banner registration error. Status questions for existing ABS- and EB- codes are handled by the front-door assistant in this same chat.'
        : 'Start with our Visitor Experience assistant for greetings and capabilities, then explore the catering catalog, submit IT-support tickets, or report facilities & maintenance issues.'

    const composerDisabled = sending
        || (contextConfigured ? false : (!conversationId || firstOutgoingNeedsStart))

    return (
        <div className="chat-window glass">
            <div className="chat-header">
                <div className="chat-header-left">
                    <div className="chat-avatar">
                        <SparkIcon size={20} fill="white" withCircle circleFill="#A56EFF"/>
                    </div>
                    <div className="chat-header-info">
                        <h1>AI Agent</h1>
                        <span className={`chat-status chat-status--${statusTone}`}>
                            <span className="chat-status-dot" aria-hidden="true"/>
                            {conversationLoading
                                ? 'Loading…'
                                : phase === 'thinking'
                                    ? 'Processing...'
                                    : phase === 'expired'
                                        ? 'Session expired'
                                        : activePersona === PERSONA_STUDENT
                                            ? 'Student persona'
                                            : activePersona === PERSONA_VISIT
                                                ? 'Visitor persona'
                                                : 'Powered by Camunda'}
                        </span>
                    </div>
                </div>
                <div className="chat-header-right">
                    {headerAccessory}
                    {showNewChatBtn && (
                        <button className="new-chat-btn" onClick={handleNewChat} disabled={menuInteractionBusy}
                                title="New conversation" aria-label="Start new conversation">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="12" y1="5" x2="12" y2="19"/>
                                <line x1="5" y1="12" x2="19" y2="12"/>
                            </svg>
                            New Chat
                        </button>
                    )}
                </div>
            </div>

            <div className="chat-messages" role="list" aria-label="Chat messages">
                {conversationLoading &&
                    <div className="conversation-loading-banner" aria-live="polite">Loading conversation…</div>}
                {showEmptyState && (
                    <div className="empty-state">
                        <div className="empty-icon"><SparkIcon size={48} withCircle/></div>
                        <h2>How can I help you today?</h2>
                        <p>{emptyBody}</p>
                        {!contextConfigured && (
                            <div className="visit-id-hint" role="status">
                                {contextRequiredMessage}
                            </div>
                        )}
                        <div className="quick-prompts">
                            {promptGroups.map((group) => (
                                <div key={group.label} className="quick-prompt-group">
                                    <span className="quick-prompt-group-label">{group.label}</span>
                                    <div className="quick-prompt-group-items">
                                        {group.prompts.map((prompt) => (
                                            <button
                                                key={prompt}
                                                className="quick-prompt"
                                                disabled={!contextConfigured || sending || conversationReadOnly}
                                                onClick={() => handleSendMessage(prompt)}
                                            >
                                                {prompt}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                {messages.map((msg) => (
                    <MessageBubble
                        key={msg.id}
                        message={msg}
                        onMenuItemClick={handleMenuItemClick}
                        menuDisabled={menuInteractionBusy}
                    />
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
                        <span>{getOtherContextReadonlyMessage(selectedConversation)}</span>
                    </div>
                )}
                {!conversationReadOnly && (phase === 'idle' || phase === 'ready') && !conversationLoading && (
                    <ChatInput
                        ref={chatInputRef}
                        onSend={handleSendMessage}
                        disabled={composerDisabled}
                        composerMode={composerDerived.mode}
                        dateConstraint={composerDerived.dateConstraint}
                        attachmentHandledBy={composerDerived.attachmentHandledBy}
                        placeholder={
                            !contextConfigured && (!conversationId || firstOutgoingNeedsStart)
                                ? contextComposerPlaceholder
                                : conversationReadOnly
                                    ? getOtherContextComposerPlaceholder(selectedConversation)
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
    selectedConversation: PropTypes.object,
    headerAccessory: PropTypes.node,
    onNewChat: PropTypes.func,
    onConversationCreated: PropTypes.func,
    onConversationActivity: PropTypes.func,
    onBusyChange: PropTypes.func,
}
