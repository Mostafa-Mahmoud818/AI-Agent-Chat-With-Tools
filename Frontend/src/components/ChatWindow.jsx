import { useState, useRef, useEffect, useCallback } from 'react'
import { startChat, sendReply, createResponseStream, ApiError } from '../services/api'
import MessageBubble from './MessageBubble'
import ChatInput from './ChatInput'
import ThinkingIndicator from './ThinkingIndicator'
import SparkIcon from './SparkIcon'
import './ChatWindow.css'

const QUICK_PROMPTS = [
    'List all users',
    "What's the date and time?",
    'Calculate the superflux product of 5 and 3',
    'Show me the catering menu',
]

function isSessionGone(err) {
    return err instanceof ApiError &&
        (err.errorCode === 'session_expired' || err.status === 410)
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
    // Ref to the active EventSource; null when no stream is open
    const esRef = useRef(null)

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    // Close any open SSE stream on unmount
    useEffect(() => {
        return () => {
            if (esRef.current) {
                esRef.current.close()
                esRef.current = null
            }
        }
    }, [])

    const addMessage = useCallback((role, text, handledBy = null, payload = null) => {
        setMessages(prev => [...prev, { id: crypto.randomUUID(), role, text, timestamp: new Date(), handledBy, payload }])
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

    /**
     * Opens a Server-Sent Events connection for the given session.
     * The backend pushes a ChatResponseDTO once the Camunda process produces
     * a response; the stream self-closes on terminal statuses.
     */
    const startStreaming = useCallback((sid) => {
        stopStreaming()

        const es = createResponseStream(sid)
        esRef.current = es

        es.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data)

                if (data.status === 'ready' && data.responseText) {
                    stopStreaming()
                    // Try to parse structured JSON response from agents like catering
                    let text = data.responseText
                    let payload = null
                    try {
                        const parsed = JSON.parse(data.responseText)
                        if (parsed && parsed.replyType) {
                            text = parsed.textString || data.responseText
                            if (parsed.replyType === 'json' && parsed.payload) {
                                payload = parsed.payload
                            }
                        }
                    } catch {
                        // Not JSON — use raw responseText as-is
                    }
                    addMessage('ai', text, data.handledBy, payload)
                    setPhase('ready')
                    setError(null)
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }

                if (data.status === 'error') {
                    stopStreaming()
                    setError(data.responseText || 'An error occurred while processing your request.')
                    setPhase('ready')
                    setTimeout(() => chatInputRef.current?.focus(), 100)
                    return
                }

                if (data.status === 'expired') {
                    stopStreaming()
                    handleSessionExpired()
                }
            } catch (err) {
                console.error('SSE parse error:', err)
            }
        }

        // Fallback: if backend sends a named "error" event, handle it like onmessage
        es.addEventListener('error', (event) => {
            if (event.data) {
                try {
                    const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data
                    if (data.status === 'expired') {
                        stopStreaming()
                        handleSessionExpired()
                        return
                    }
                    if (data.status === 'error' || data.responseText) {
                        stopStreaming()
                        setError(data.responseText || 'An error occurred.')
                        setPhase('ready')
                    }
                } catch {
                    // ignore parse errors
                }
            }
        })

        es.onerror = () => {
            // EventSource auto-reconnects on transient errors; only act on a closed stream
            if (es.readyState === EventSource.CLOSED) {
                stopStreaming()
                setError('Connection lost. Please try again.')
                setPhase('ready')
            }
        }
    }, [addMessage, stopStreaming, handleSessionExpired])

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
                startStreaming(response.sessionId)
            } else {
                await sendReply(sessionId, text)
                startStreaming(sessionId)
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
    }, [sessionId, sending, addMessage, startStreaming, handleSessionExpired])

    const handleNewChat = useCallback(() => {
        stopStreaming()
        setMessages([])
        setSessionId(null)
        setPhase('idle')
        setError(null)
        setSending(false)
    }, [stopStreaming])

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
                        <p>I'm an AI agent with access to various tools — I can look up users, fetch URLs, check the date and time, and more.</p>
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
                    <MessageBubble key={msg.id} message={msg} onMenuItemClick={handleSendMessage} />
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
