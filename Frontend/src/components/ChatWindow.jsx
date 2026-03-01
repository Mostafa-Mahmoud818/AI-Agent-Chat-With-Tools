import { useState, useRef, useEffect, useCallback } from 'react'
import { startChat, getResponse, sendReply, ApiError } from '../services/api'
import MessageBubble from './MessageBubble'
import ChatInput from './ChatInput'
import ThinkingIndicator from './ThinkingIndicator'
import SparkIcon from './SparkIcon'
import './ChatWindow.css'

const POLL_INTERVAL = 3000
const MAX_POLL_ATTEMPTS = 200

const QUICK_PROMPTS = [
    'Tell me a joke',
    'List all users',
    'Search for pasta recipes',
    "What's the date and time?",
    'Calculate the superflux product of 5 and 3',
]

function isSessionGone(err) {
    return err instanceof ApiError &&
        (err.errorCode === 'session_expired' || err.status === 410)
}

function isSessionMissing(err) {
    return err instanceof ApiError &&
        (err.errorCode === 'session_not_found' || err.status === 404)
}

export default function ChatWindow() {
    const [messages, setMessages] = useState([])
    const [sessionId, setSessionId] = useState(null)
    const [phase, setPhase] = useState('idle') // idle | thinking | ready | expired
    const [error, setError] = useState(null)
    const [sending, setSending] = useState(false)
    const messagesEndRef = useRef(null)
    // Ref to the ChatInput for programmatic focus
    const chatInputRef = useRef(null)
    // Timeout handle for the self-scheduling poller
    const pollTimeoutRef = useRef(null)
    // Cancellation flag: set to true to stop any in-flight poll cycle
    const pollCancelledRef = useRef(false)
    const pollCountRef = useRef(0)

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            pollCancelledRef.current = true
            if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current)
        }
    }, [])

    const addMessage = useCallback((role, text, handledBy = null) => {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role, text, timestamp: new Date(), handledBy }])
    }, [])

    const stopPolling = useCallback(() => {
        pollCancelledRef.current = true
        if (pollTimeoutRef.current) {
            clearTimeout(pollTimeoutRef.current)
            pollTimeoutRef.current = null
        }
        pollCountRef.current = 0
    }, [])

    const handleSessionExpired = useCallback(() => {
        stopPolling()
        setPhase('expired')
        addMessage('system', 'Session has expired due to inactivity. Please start a new conversation.')
    }, [stopPolling, addMessage])

    /**
     * Self-scheduling poll function using setTimeout instead of setInterval.
     * This ensures a new poll only starts after the previous one completes,
     * preventing concurrent in-flight requests from building up.
     */
    const schedulePoll = useCallback((sid) => {
        // Guard: if polling was cancelled between schedule and execution, do nothing
        if (pollCancelledRef.current) return

        pollCountRef.current++

        if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
            stopPolling()
            setError('The agent is taking too long to respond. Please try starting a new chat.')
            setPhase('ready')
            return
        }

        const runPoll = async () => {
            // Double-check cancellation right before the async call
            if (pollCancelledRef.current) return

            try {
                const data = await getResponse(sid)

                // Ignore stale results if polling was cancelled while the request was in-flight
                if (pollCancelledRef.current) return

                if (data.status === 'ready' && data.responseText) {
                    stopPolling()
                    addMessage('ai', data.responseText, data.handledBy)
                    setPhase('ready')
                    setError(null)
                    // Focus the input via ref — no DOM query needed
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }

                if (data.status === 'error') {
                    stopPolling()
                    setError(data.responseText || 'An error occurred while processing your request.')
                    setPhase('ready')
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }

            } catch (err) {
                if (pollCancelledRef.current) return

                if (isSessionGone(err)) {
                    handleSessionExpired()
                    return
                }
                if (isSessionMissing(err)) {
                    stopPolling()
                    setError('Session not found. Please start a new conversation.')
                    setPhase('idle')
                    setSessionId(null)
                    return
                }
                console.error('Polling error:', err)
            }

            // Schedule the next poll only after this one completes (self-scheduling pattern)
            if (!pollCancelledRef.current) {
                pollTimeoutRef.current = setTimeout(() => schedulePoll(sid), POLL_INTERVAL)
            }
        }

        runPoll()
    }, [addMessage, stopPolling, handleSessionExpired])

    const startPolling = useCallback((sid) => {
        stopPolling()
        pollCancelledRef.current = false
        pollCountRef.current = 0
        // Kick off the first poll immediately via a 0-delay timeout
        pollTimeoutRef.current = setTimeout(() => schedulePoll(sid), 0)
    }, [stopPolling, schedulePoll])

    const handleSendMessage = useCallback(async (text) => {
        if (sending) return

        setError(null)
        setSending(true)
        addMessage('user', text)
        setPhase('thinking')

        try {
            if (!sessionId) {
                const response = await startChat(text)
                setSessionId(response.sessionId)
                startPolling(response.sessionId)
            } else {
                await sendReply(sessionId, text)
                startPolling(sessionId)
            }
        } catch (err) {
            if (isSessionGone(err)) {
                handleSessionExpired()
                return
            }
            if (err instanceof ApiError && err.status === 400) {
                setError(err.message)
                setPhase(sessionId ? 'ready' : 'idle')
                return
            }
            setError(
                sessionId
                    ? 'Failed to send message. The session may have expired.'
                    : 'Failed to start conversation. Is the backend running?'
            )
            setPhase(sessionId ? 'ready' : 'idle')
        } finally {
            setSending(false)
        }
    }, [sessionId, sending, addMessage, startPolling, handleSessionExpired])

    const handleNewChat = useCallback(() => {
        stopPolling()
        setMessages([])
        setSessionId(null)
        setPhase('idle')
        setError(null)
        setSending(false)
    }, [stopPolling])

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
                            {phase === 'thinking' ? 'Processing...' : phase === 'expired' ? 'Session expired' : 'Powered by Camunda'}
                        </span>
                    </div>
                </div>
                {messages.length > 0 && (
                    <button className="new-chat-btn" onClick={handleNewChat} title="New conversation" aria-label="Start new conversation">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Chat
                    </button>
                )}
            </div>

            <div className="chat-messages" role="list" aria-label="Chat messages">
                {messages.length === 0 && phase === 'idle' && (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <SparkIcon size={48} withCircle />
                        </div>
                        <h2>How can I help you today?</h2>
                        <p>I'm an AI agent with access to various tools — I can look up users, search recipes, tell jokes, fetch URLs, check the date and time, and more.</p>
                        <div className="quick-prompts">
                            {QUICK_PROMPTS.map(prompt => (
                                <button key={prompt} className="quick-prompt" onClick={() => handleSendMessage(prompt)}>
                                    {prompt}
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {messages.map(msg => (
                    <MessageBubble key={msg.id} message={msg} />
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
                {(phase === 'idle' || phase === 'ready') && (
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
