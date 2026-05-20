import { useCallback } from 'react'
import './ConversationSidebar.css'

function formatRelativeTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return ''
    const diff = Date.now() - d.getTime()
    const sec = Math.floor(diff / 1000)
    if (sec < 60) return 'Just now'
    const min = Math.floor(sec / 60)
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    if (day < 7) return `${day}d ago`
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ConversationSidebar({
    conversations,
    loading,
    error,
    selectedId,
    onSelect,
    onNewChat,
    onRefresh,
    className = '',
}) {
    const handleNew = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        onNewChat?.()
    }, [onNewChat])

    return (
        <aside className={`conversation-sidebar glass ${className}`.trim()} aria-label="Conversations">
            <div className="conversation-sidebar-header">
                <h2 className="conversation-sidebar-title">Conversations</h2>
                <button
                    type="button"
                    className="conversation-sidebar-new"
                    onClick={handleNew}
                    onMouseDown={(e) => e.preventDefault()}
                    title="New conversation"
                    aria-label="Start new conversation"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                </button>
            </div>

            {error && (
                <div className="conversation-sidebar-error" role="alert">
                    {error}
                    <button type="button" className="conversation-sidebar-retry" onClick={() => onRefresh?.()}>
                        Retry
                    </button>
                </div>
            )}

            <ul className="conversation-sidebar-list">
                {loading && conversations.length === 0 && (
                    <li className="conversation-sidebar-placeholder">Loading…</li>
                )}
                {!loading && conversations.length === 0 && !error && (
                    <li className="conversation-sidebar-placeholder">No conversations yet</li>
                )}
                {conversations.map((c) => {
                    const id = c.id
                    const title = (c.title && String(c.title).trim()) || 'Conversation'
                    const active = selectedId != null && String(selectedId) === String(id)
                    return (
                        <li key={id}>
                            <button
                                type="button"
                                className={`conversation-sidebar-item${active ? ' conversation-sidebar-item--active' : ''}`}
                                onClick={() => onSelect?.(id)}
                            >
                                <span className="conversation-sidebar-item-title">{title}</span>
                                <span className="conversation-sidebar-item-meta">
                                    {formatRelativeTime(c.lastTurnAt ?? c.updatedAt)}
                                </span>
                            </button>
                        </li>
                    )
                })}
            </ul>
        </aside>
    )
}
