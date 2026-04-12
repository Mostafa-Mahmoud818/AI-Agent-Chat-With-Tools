import { useState, useEffect, useCallback } from 'react'
import { getConversations, isSecureMode, ApiError } from '../services/api'
import { createLogger } from '../utils/logger.js'
import ConversationSidebar from './ConversationSidebar'
import ChatWindow from './ChatWindow'
import './ChatLayout.css'

const log = createLogger('ChatLayout')

export default function ChatLayout() {
    const [conversations, setConversations] = useState([])
    const [convosLoading, setConvosLoading] = useState(true)
    const [convosError, setConvosError] = useState(null)
    const [selectedConversationId, setSelectedConversationId] = useState(null)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [authKey, setAuthKey] = useState(() => (isSecureMode() ? 'secure' : 'guest'))
    const [resetKey, setResetKey] = useState(0)

    const loadConversations = useCallback(async () => {
        setConvosLoading(true)
        setConvosError(null)
        try {
            const data = await getConversations({ page: 0, size: 100 })
            setConversations(data.content ?? [])
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : 'Failed to load conversations'
            log.warn('loadConversations failed', e)
            setConvosError(msg)
            setConversations([])
        } finally {
            setConvosLoading(false)
        }
    }, [])

    useEffect(() => {
        loadConversations()
    }, [loadConversations, authKey])

    useEffect(() => {
        const onStorage = (ev) => {
            if (ev.key === 'ankabut_jwt') {
                setAuthKey(isSecureMode() ? 'secure' : 'guest')
                setSelectedConversationId(null)
            }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const handleSelectConversation = useCallback((id) => {
        setSelectedConversationId(id)
        setSidebarOpen(false)
    }, [])

    const handleNewChat = useCallback(() => {
        setSelectedConversationId(null)
    }, [])

    const handleSidebarNewChat = useCallback(() => {
        // Increment reset key to force ChatWindow to reset even if selectedConversationId is already null
        setResetKey((k) => k + 1)
        setSelectedConversationId(null)
    }, [])

    const handleConversationCreated = useCallback(() => {
        loadConversations()
    }, [loadConversations])

    return (
        <div className="chat-layout">
            <button
                type="button"
                className="chat-layout-sidebar-toggle"
                onClick={() => setSidebarOpen((o) => !o)}
                aria-expanded={sidebarOpen}
                aria-controls="conversation-sidebar-panel"
            >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                    <line x1="4" y1="6" x2="20" y2="6" />
                    <line x1="4" y1="12" x2="20" y2="12" />
                    <line x1="4" y1="18" x2="16" y2="18" />
                </svg>
                <span className="chat-layout-sidebar-toggle-label">Chats</span>
            </button>

            {sidebarOpen && (
                <button
                    type="button"
                    className="chat-layout-backdrop"
                    aria-label="Close sidebar"
                    onClick={() => setSidebarOpen(false)}
                />
            )}

            <div
                id="conversation-sidebar-panel"
                className={`chat-layout-sidebar${sidebarOpen ? ' chat-layout-sidebar--open' : ''}`}
            >
                <ConversationSidebar
                    conversations={conversations}
                    loading={convosLoading}
                    error={convosError}
                    selectedId={selectedConversationId}
                    onSelect={handleSelectConversation}
                    onNewChat={handleSidebarNewChat}
                    onRefresh={loadConversations}
                />
            </div>

            <main className="chat-layout-main">
                <ChatWindow
                    sidebarConversationId={selectedConversationId}
                    key={resetKey}
                    onNewChat={handleNewChat}
                    onConversationCreated={handleConversationCreated}
                />
            </main>
        </div>
    )
}
