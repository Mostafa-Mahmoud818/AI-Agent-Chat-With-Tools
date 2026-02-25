import { useState, useRef, useEffect, useCallback } from 'react'
import { startChat, getTasks, completeTask } from '../services/api'
import MessageBubble from './MessageBubble'
import ChatInput from './ChatInput'
import FeedbackPanel from './FeedbackPanel'
import EmailApprovalPanel from './EmailApprovalPanel'
import ThinkingIndicator from './ThinkingIndicator'
import './ChatWindow.css'

const POLL_INTERVAL = 3000

export default function ChatWindow() {
    const [messages, setMessages] = useState([])
    const [processInstanceKey, setProcessInstanceKey] = useState(null)
    const [phase, setPhase] = useState('idle') // idle | thinking | feedback | email-approval | done
    const [currentTask, setCurrentTask] = useState(null)
    const [error, setError] = useState(null)
    const messagesEndRef = useRef(null)
    const pollRef = useRef(null)

    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [])

    useEffect(() => {
        scrollToBottom()
    }, [messages, phase, scrollToBottom])

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current)
        }
    }, [])

    const addMessage = useCallback((role, text, meta) => {
        setMessages(prev => [...prev, { id: Date.now(), role, text, meta, timestamp: new Date() }])
    }, [])

    const startPolling = useCallback((piKey) => {
        if (pollRef.current) clearInterval(pollRef.current)

        pollRef.current = setInterval(async () => {
            try {
                const tasks = await getTasks(piKey)
                if (tasks && tasks.length > 0) {
                    clearInterval(pollRef.current)
                    pollRef.current = null

                    const task = tasks[0]
                    setCurrentTask(task)

                    // Determine which form this is
                    if (task.name === 'User Feedback') {
                        const responseText = task.variables?.responseText || 'No response from agent.'
                        addMessage('ai', responseText)
                        setPhase('feedback')
                    } else if (task.name === 'Ask human to send email') {
                        setPhase('email-approval')
                    } else {
                        // Generic user task
                        const responseText = task.variables?.responseText || JSON.stringify(task.variables)
                        addMessage('ai', responseText)
                        setPhase('feedback')
                    }
                }
            } catch (err) {
                console.error('Polling error:', err)
            }
        }, POLL_INTERVAL)
    }, [addMessage])

    const handleSendMessage = useCallback(async (text) => {
        setError(null)
        addMessage('user', text)
        setPhase('thinking')

        try {
            const response = await startChat(text)
            setProcessInstanceKey(response.processInstanceKey)
            startPolling(response.processInstanceKey)
        } catch (err) {
            setError('Failed to start conversation. Is the backend running?')
            setPhase('idle')
        }
    }, [addMessage, startPolling])

    const handleFeedback = useCallback(async (satisfied, followUpText) => {
        if (!currentTask) return

        try {
            if (satisfied) {
                addMessage('user', '✅ I\'m satisfied with this answer.')
                await completeTask(currentTask.userTaskKey, { userSatisfied: true })
                setPhase('done')
                addMessage('ai', 'Great! Glad I could help. Feel free to start a new conversation anytime! 👋')
            } else {
                addMessage('user', followUpText || 'I need more help...')
                setPhase('thinking')
                await completeTask(currentTask.userTaskKey, {
                    userSatisfied: false,
                    followUpInput: followUpText || ''
                })
                setCurrentTask(null)
                startPolling(processInstanceKey)
            }
        } catch (err) {
            setError('Failed to send feedback. Please try again.')
            setPhase('feedback')
        }
    }, [currentTask, processInstanceKey, addMessage, startPolling])

    const handleEmailApproval = useCallback(async (emailOk, operatorFeedback) => {
        if (!currentTask) return

        try {
            addMessage('user', emailOk ? '✅ Email approved for sending.' : `❌ Email not approved. Feedback: ${operatorFeedback}`)
            setPhase('thinking')
            await completeTask(currentTask.userTaskKey, { emailOk, operatorFeedback: operatorFeedback || '' })
            setCurrentTask(null)
            startPolling(processInstanceKey)
        } catch (err) {
            setError('Failed to process email approval.')
            setPhase('email-approval')
        }
    }, [currentTask, processInstanceKey, addMessage, startPolling])

    const handleNewChat = useCallback(() => {
        if (pollRef.current) clearInterval(pollRef.current)
        setMessages([])
        setProcessInstanceKey(null)
        setCurrentTask(null)
        setPhase('idle')
        setError(null)
    }, [])

    return (
        <div className="chat-window glass">
            {/* Header */}
            <div className="chat-header">
                <div className="chat-header-left">
                    <div className="chat-avatar">
                        <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
                            <circle cx="16" cy="16" r="16" fill="#A56EFF" />
                            <path fillRule="evenodd" clipRule="evenodd" d="M20 12.1C18.49 10.59 17.16 8.11 16.18 6.01C16.15 6 16.12 6 16.08 6C16.04 6 16.01 6 15.98 6.01C15 8.11 13.67 10.59 12.15 12.1C10.63 13.61 8.13 14.93 6.01 15.9C6 15.93 6 15.96 6 16C6 16.04 6 16.07 6.01 16.1C8.13 17.07 10.63 18.39 12.15 19.9C13.67 21.41 15 23.89 15.98 25.99C16.01 26 16.04 26 16.08 26C16.12 26 16.15 26 16.18 25.99C17.16 23.89 18.49 21.41 20.01 19.9C21.53 18.4 23.95 17.07 25.99 16.08C26 16.06 26 16.03 26 16C26 15.97 26 15.94 25.99 15.92C23.95 14.93 21.53 13.6 20 12.1Z" fill="white" />
                        </svg>
                    </div>
                    <div className="chat-header-info">
                        <h1>AI Agent</h1>
                        <span className="chat-status">
                            {phase === 'thinking' ? 'Processing...' : phase === 'done' ? 'Conversation ended' : 'Powered by Camunda'}
                        </span>
                    </div>
                </div>
                {(phase === 'done' || messages.length > 0) && (
                    <button className="new-chat-btn" onClick={handleNewChat} title="New conversation">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                        New Chat
                    </button>
                )}
            </div>

            {/* Messages Area */}
            <div className="chat-messages">
                {messages.length === 0 && phase === 'idle' && (
                    <div className="empty-state">
                        <div className="empty-icon">
                            <svg width="48" height="48" viewBox="0 0 32 32" fill="none">
                                <circle cx="16" cy="16" r="16" fill="rgba(165, 110, 255, 0.15)" />
                                <path fillRule="evenodd" clipRule="evenodd" d="M20 12.1C18.49 10.59 17.16 8.11 16.18 6.01C16.15 6 16.12 6 16.08 6C16.04 6 16.01 6 15.98 6.01C15 8.11 13.67 10.59 12.15 12.1C10.63 13.61 8.13 14.93 6.01 15.9C6 15.93 6 15.96 6 16C6 16.04 6 16.07 6.01 16.1C8.13 17.07 10.63 18.39 12.15 19.9C13.67 21.41 15 23.89 15.98 25.99C16.01 26 16.04 26 16.08 26C16.12 26 16.15 26 16.18 25.99C17.16 23.89 18.49 21.41 20.01 19.9C21.53 18.4 23.95 17.07 25.99 16.08C26 16.06 26 16.03 26 16C26 15.97 26 15.94 25.99 15.92C23.95 14.93 21.53 13.6 20 12.1Z" fill="#A56EFF" />
                            </svg>
                        </div>
                        <h2>How can I help you today?</h2>
                        <p>I'm an AI agent with access to various tools — I can look up users, search recipes, tell jokes, fetch URLs, and more.</p>
                        <div className="quick-prompts">
                            {['Tell me a joke', 'List all users', 'Search for pasta recipes', 'What time is it?'].map(prompt => (
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

            {/* Bottom Panel */}
            <div className="chat-bottom">
                {phase === 'feedback' && currentTask && (
                    <FeedbackPanel onFeedback={handleFeedback} />
                )}

                {phase === 'email-approval' && currentTask && (
                    <EmailApprovalPanel task={currentTask} onApproval={handleEmailApproval} />
                )}

                {(phase === 'idle') && (
                    <ChatInput onSend={handleSendMessage} placeholder="Type your message..." />
                )}

                {phase === 'thinking' && (
                    <div className="waiting-hint">
                        <span>Agent is working on your request...</span>
                    </div>
                )}

                {phase === 'done' && (
                    <div className="waiting-hint">
                        <span>Conversation ended.</span>
                        <button className="inline-new-chat" onClick={handleNewChat}>Start a new one</button>
                    </div>
                )}
            </div>
        </div>
    )
}
