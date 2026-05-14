/**
 * Root layout: conversation list + main chat (secure bearer or public guest API).
 * @module components/layout/ChatLayout
 */

import { useState, useEffect, useCallback } from 'react'
import { getConversations, ApiError } from '../../services/api'
import { bumpConversationLastActivity, sortConversationsForSidebar } from '../../utils/conversationSidebarOrder.js'
import { createLogger } from '../../utils/logger.js'
import { shouldUseLocalOtpFlow } from '../../auth/localAccessTokenFlow.js'
import { getAccessToken } from '../../auth/tokenStore.js'
import { isGuestChatAuth } from '../../config/chatAuth.js'
import { syncGuestCookie } from '../../auth/guestClientId.js'
import ConversationSidebar from '../sidebar/ConversationSidebar.jsx'
import ChatWindow from '../chat/ChatWindow.jsx'
import LocalAuthDialog from '../auth/LocalAuthDialog.jsx'
import './ChatLayout.css'

const log = createLogger('ChatLayout')

const guestMode = isGuestChatAuth(import.meta.env)

export default function ChatLayout() {
    const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()))
    const [conversations, setConversations] = useState([])
    const [convosLoading, setConvosLoading] = useState(true)
    const [convosError, setConvosError] = useState(null)
    const [selectedConversationId, setSelectedConversationId] = useState(null)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [resetKey, setResetKey] = useState(0)

    const chatApiReady = guestMode || authenticated

    useEffect(() => {
        if (guestMode) syncGuestCookie()
    }, [])

    const loadConversations = useCallback(async (opts = {}) => {
        const silent = opts.silent === true
        if (!chatApiReady) {
            if (!silent) setConvosLoading(false)
            setConversations([])
            return
        }
        if (!silent) {
            setConvosLoading(true)
            setConvosError(null)
        }
        try {
            const data = await getConversations({ page: 0, size: 100 })
            setConversations(sortConversationsForSidebar(data.content ?? []))
            if (!silent) setConvosError(null)
        } catch (e) {
            const msg = e instanceof ApiError ? e.message : 'Failed to load conversations'
            log.warn('loadConversations failed', e)
            if (!silent) {
                setConvosError(msg)
                setConversations([])
            }
        } finally {
            if (!silent) setConvosLoading(false)
        }
    }, [chatApiReady])

    useEffect(() => {
        loadConversations()
    }, [loadConversations])

    useEffect(() => {
        setAuthenticated(Boolean(getAccessToken()))
    }, [])

    const requiresLocalAuth = shouldUseLocalOtpFlow(import.meta.env) && !authenticated && !guestMode

    const handleSelectConversation = useCallback((id) => {
        setSelectedConversationId(id)
        setSidebarOpen(false)
    }, [])

    const handleNewChat = useCallback(() => {
        setSelectedConversationId(null)
    }, [])

    const handleSidebarNewChat = useCallback(() => {
        setResetKey((k) => k + 1)
        setSelectedConversationId(null)
    }, [])

    const handleConversationCreated = useCallback(() => {
        loadConversations()
    }, [loadConversations])

    const handleConversationActivity = useCallback(
        (conversationId, atIso = new Date().toISOString()) => {
            if (conversationId == null || String(conversationId).trim() === '') return
            const cid = String(conversationId)
            setConversations((prev) => {
                const exists = prev.some((c) => String(c.id) === cid)
                if (!exists) {
                    loadConversations({ silent: true })
                    return prev
                }
                return bumpConversationLastActivity(prev, cid, atIso)
            })
        },
        [loadConversations],
    )

    return (
        <div className="chat-layout">
            {requiresLocalAuth && (
                <LocalAuthDialog onAuthenticated={() => setAuthenticated(true)} />
            )}
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
                    loading={convosLoading || requiresLocalAuth}
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
                    onConversationActivity={handleConversationActivity}
                />
            </main>
        </div>
    )
}
