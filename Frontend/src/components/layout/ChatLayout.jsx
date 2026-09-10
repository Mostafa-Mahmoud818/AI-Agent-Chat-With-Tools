/**
 * Root layout: conversation list + main chat (JWT secure only).
 * @module components/layout/ChatLayout
 */

import {useCallback, useEffect, useState} from 'react'
import {
    ApiError,
    archiveConversation,
    deleteConversation,
    loadAllConversations,
    unarchiveConversation,
} from '../../services/api'
import PersonaPicker from './PersonaPicker.jsx'
import {bumpConversationLastActivity, sortConversationsForSidebar} from '../../utils/conversationSidebarOrder.js'
import {createLogger} from '../../utils/logger.js'
import {getAccessToken} from '../../auth/tokenStore.js'
import {tryResolveVisitIdForCurrentUser} from '../../auth/visitResolution.js'
import {tryResolveStudentIdForCurrentUser} from '../../auth/studentResolution.js'
import {
    ensureActivePersona,
    isOtherContextConversation,
} from '../../config/personaSession.js'
import ConversationSidebar from '../sidebar/ConversationSidebar.jsx'
import ChatWindow from '../chat/ChatWindow.jsx'
import LocalAuthDialog from '../auth/LocalAuthDialog.jsx'
import './ChatLayout.css'

const log = createLogger('ChatLayout')

export default function ChatLayout() {
    const [authenticated, setAuthenticated] = useState(Boolean(getAccessToken()))
    const [conversations, setConversations] = useState([])
    const [convosLoading, setConvosLoading] = useState(true)
    const [convosError, setConvosError] = useState(null)
    const [selectedConversationId, setSelectedConversationId] = useState(null)
    const [sidebarOpen, setSidebarOpen] = useState(false)
    const [resetKey, setResetKey] = useState(0)
    const [showArchived, setShowArchived] = useState(false)
    const [personaKey, setPersonaKey] = useState(0)
    const [chatBusy, setChatBusy] = useState(false)

    const chatApiReady = authenticated

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
            const rows = await loadAllConversations({size: 100, archived: showArchived})
            setConversations(sortConversationsForSidebar(rows))
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
    }, [chatApiReady, showArchived])

    useEffect(() => {
        loadConversations()
    }, [loadConversations])

    useEffect(() => {
        setAuthenticated(Boolean(getAccessToken()))
        ensureActivePersona()
    }, [])

    const requiresAuth = import.meta.env.MODE !== 'test' && !authenticated

    const handleAuthenticated = useCallback(async ({
        visitId: visitFromDialog,
        studentId: studentFromDialog,
        contextResolved = false,
    } = {}) => {
        setAuthenticated(true)
        const token = getAccessToken()
        // OTP already ran visit + profile/me (when eligible). Do not re-POST check-eligibility.
        if (token && !contextResolved) {
            if (!visitFromDialog) {
                await tryResolveVisitIdForCurrentUser(import.meta.env, token, {attempts: 1, delayMs: 0})
            }
            if (!studentFromDialog) {
                await tryResolveStudentIdForCurrentUser(import.meta.env, token)
            }
        }
        ensureActivePersona()
        setPersonaKey((k) => k + 1)
        loadConversations()
    }, [loadConversations])

    const handlePersonaChange = useCallback(() => {
        setPersonaKey((k) => k + 1)
        // Switching persona does not rewrite an open conversation's frozen context —
        // other-context conversations become read-only; New Chat uses the new envelope.
    }, [])

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
                    loadConversations({silent: true})
                    return prev
                }
                return bumpConversationLastActivity(prev, cid, atIso)
            })
        },
        [loadConversations],
    )

    const handleToggleArchived = useCallback(() => {
        setShowArchived((v) => !v)
        setSelectedConversationId(null)
    }, [])

    const applyConversationMutation = useCallback(
        async (conversationId, mutate) => {
            const cid = String(conversationId)
            setConversations((prev) => prev.filter((c) => String(c.id) !== cid))
            setSelectedConversationId((sel) => (String(sel) === cid ? null : sel))
            try {
                await mutate(conversationId)
                loadConversations({silent: true})
            } catch (e) {
                log.warn('conversation mutation failed', e)
                loadConversations()
            }
        },
        [loadConversations],
    )

    const handleArchiveConversation = useCallback(
        (id) => applyConversationMutation(id, archiveConversation),
        [applyConversationMutation],
    )

    const handleUnarchiveConversation = useCallback(
        (id) => applyConversationMutation(id, unarchiveConversation),
        [applyConversationMutation],
    )

    const handleDeleteConversation = useCallback(
        (id) => applyConversationMutation(id, deleteConversation),
        [applyConversationMutation],
    )

    const selectedConversation =
        selectedConversationId != null
            ? conversations.find((c) => String(c.id) === String(selectedConversationId)) ?? null
            : null
    const conversationReadOnly = isOtherContextConversation(selectedConversation)

    return (
        <div className="chat-layout">
            {requiresAuth && (
                <LocalAuthDialog onAuthenticated={handleAuthenticated}/>
            )}
            <button
                type="button"
                className="chat-layout-sidebar-toggle"
                onClick={() => setSidebarOpen((o) => !o)}
                aria-expanded={sidebarOpen}
                aria-controls="conversation-sidebar-panel"
            >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                     aria-hidden="true">
                    <line x1="4" y1="6" x2="20" y2="6"/>
                    <line x1="4" y1="12" x2="20" y2="12"/>
                    <line x1="4" y1="18" x2="16" y2="18"/>
                </svg>
                <span className="chat-layout-sidebar-toggle-label">Chats</span>
            </button>

            {sidebarOpen && (
                <button
                    type="button"
                    className="chat-layout-backdrop chat-layout-backdrop--visible"
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
                    newChatDisabled={chatBusy}
                    selectDisabled={chatBusy}
                    onRefresh={loadConversations}
                    onArchive={handleArchiveConversation}
                    onUnarchive={handleUnarchiveConversation}
                    onDelete={handleDeleteConversation}
                    showArchived={showArchived}
                    onToggleArchived={handleToggleArchived}
                />
            </div>

            <main className="chat-layout-main">
                <ChatWindow
                    sidebarConversationId={selectedConversationId}
                    conversationReadOnly={conversationReadOnly}
                    selectedConversation={selectedConversation}
                    key={`${resetKey}-${personaKey}-${selectedConversationId ?? 'new'}`}
                    headerAccessory={authenticated
                        ? <PersonaPicker key={personaKey} onPersonaChange={handlePersonaChange} disabled={chatBusy}/>
                        : null}
                    onNewChat={handleNewChat}
                    onConversationCreated={handleConversationCreated}
                    onConversationActivity={handleConversationActivity}
                    onBusyChange={setChatBusy}
                />
            </main>
        </div>
    )
}
