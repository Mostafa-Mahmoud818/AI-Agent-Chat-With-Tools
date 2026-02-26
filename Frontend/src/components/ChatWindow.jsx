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
    const pollRef = useRef(null)
    const pollCountRef = useRef(0)

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [])

    const addMessage = useCallback((role, text) => {
        setMessages(prev => [...prev, { id: Date.now() + Math.random(), role, text, timestamp: new Date() }])
    }, [])

    const stopPolling = useCallback(() => {
        if (pollRef.current) {
            clearInterval(pollRef.current)
            pollRef.current = null
        }
        pollCountRef.current = 0
    }, [])

    const handleSessionExpired = useCallback(() => {
        stopPolling()
        setPhase('expired')
        addMessage('system', 'Session has expired due to inactivity. Please start a new conversation.')
    }, [stopPolling, addMessage])

    const startPolling = useCallback((sid) => {
        stopPolling()
        pollCountRef.current = 0

        pollRef.current = setInterval(async () => {
            pollCountRef.current++

            if (pollCountRef.current > MAX_POLL_ATTEMPTS) {
                stopPolling()
                setError('The agent is taking too long to respond. Please try starting a new chat.')
                setPhase('ready')
                return
            }

            try {
                const data = await getResponse(sid)
                if (data.status === 'ready' && data.responseText) {
                    stopPolling()
                    addMessage('ai', data.responseText)
                    setPhase('ready')
                    setError(null)
                }
            } catch (err) {
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
        }, POLL_INTERVAL)
    }, [addMessage, stopPolling, handleSessionExpired])

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
                    <button className="new-chat-btn" onClick={handleNewChat} title="New conversation">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Chat
                    </button>
                )}
            </div>

            <div className="chat-messages">
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

                {phase === 'thinking' && <ThinkingIndicator />}

                {error && (
                    <div className="error-banner">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                        </svg>
                        {error}
                    </div>
                )}

                <div ref={messagesEndRef} />
            </div>

            <div className="chat-bottom">
                {(phase === 'idle' || phase === 'ready') && (
                    <ChatInput
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
