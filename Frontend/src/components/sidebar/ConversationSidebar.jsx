import {useCallback, useMemo, useState} from 'react'
import SparkIcon from '../ui/SparkIcon.jsx'
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
    return d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})
}

export default function ConversationSidebar({
                                                conversations,
                                                loading,
                                                error,
                                                selectedId,
                                                onSelect,
                                                onNewChat,
                                                newChatDisabled = false,
                                                selectDisabled = false,
                                                onRefresh,
                                                onArchive,
                                                onUnarchive,
                                                onDelete,
                                                showArchived = false,
                                                onToggleArchived,
                                                className = '',
                                            }) {
    const [query, setQuery] = useState('')
    const handleNew = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        onNewChat?.()
    }, [onNewChat])

    const handleToggleArchived = useCallback((e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggleArchived?.()
    }, [onToggleArchived])

    const handleArchiveAction = useCallback((e, id, archived) => {
        e.preventDefault()
        e.stopPropagation()
        if (archived) {
            onUnarchive?.(id)
        } else {
            onArchive?.(id)
        }
    }, [onArchive, onUnarchive])

    const handleDeleteAction = useCallback((e, id, title) => {
        e.preventDefault()
        e.stopPropagation()
        const ok = window.confirm(`Delete
        "${title}"? This conversation will be removed from your list.`)
        if (ok) onDelete?.(id)
    }, [onDelete])

    const emptyText = showArchived ? 'No archived conversations' : 'No conversations yet'
    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        if (!q) return conversations
        return conversations.filter((c) => {
            const title = (c.title && String(c.title).trim()) || 'Conversation'
            return title.toLowerCase().includes(q)
        })
    }, [conversations, query])

    return (
        <aside className={`conversation-sidebar glass ${className}`.trim()} aria-label="Conversations">
            <div className="conversation-sidebar-brand">
                <SparkIcon size={22} withCircle />
                <div>
                    <p className="conversation-sidebar-brand-name">AI Agent Chat</p>
                    <p className="conversation-sidebar-brand-sub">Camunda · Bedrock</p>
                </div>
            </div>
            <div className="conversation-sidebar-header">
                <h2 className="conversation-sidebar-title">{showArchived ? 'Archived' : 'Conversations'}</h2>
                <div className="conversation-sidebar-header-actions">
                    <button
                        type="button"
                        className="conversation-sidebar-toggle-archived"
                        onClick={handleToggleArchived}
                        onMouseDown={(e) => e.preventDefault()}
                        aria-pressed={showArchived}
                        title={showArchived ? 'Show active conversations' : 'Show archived conversations'}
                        aria-label={showArchived ? 'Show active conversations' : 'Show archived conversations'}
                    >
                        {showArchived ? (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" aria-hidden="true">
                                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                            </svg>
                        ) : (
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2" aria-hidden="true">
                                <rect x="3" y="4" width="18" height="4" rx="1"/>
                                <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>
                                <line x1="10" y1="12" x2="14" y2="12"/>
                            </svg>
                        )}
                    </button>
                    <button
                        type="button"
                        className="conversation-sidebar-new"
                        onClick={handleNew}
                        onMouseDown={(e) => e.preventDefault()}
                        disabled={newChatDisabled}
                        title="New conversation"
                        aria-label="Start new conversation"
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                             strokeWidth="2" aria-hidden="true">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                    </button>
                </div>
            </div>

            {error && (
                <div className="conversation-sidebar-error" role="alert">
                    {error}
                    <button type="button" className="conversation-sidebar-retry" onClick={() => onRefresh?.()}>
                        Retry
                    </button>
                </div>
            )}

            <div className="conversation-sidebar-search-wrap">
                <input
                    type="search"
                    className="conversation-sidebar-search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search chats"
                    aria-label="Search conversations"
                    autoComplete="off"
                />
            </div>

            <ul className="conversation-sidebar-list">
                {loading && conversations.length === 0 && (
                    <>
                        <li className="sr-only">Loading…</li>
                        {[0, 1, 2, 3, 4].map((i) => (
                            <li key={i} className="conversation-sidebar-skeleton" aria-hidden="true">
                                <span className="conversation-sidebar-skeleton-title skeleton-loading" />
                                <span className="conversation-sidebar-skeleton-meta skeleton-loading" />
                            </li>
                        ))}
                    </>
                )}
                {!loading && conversations.length === 0 && !error && (
                    <li className="conversation-sidebar-placeholder">
                        <span className="conversation-sidebar-empty-title">{emptyText}</span>
                        {!showArchived && (
                            <span className="conversation-sidebar-empty-hint">Start a new chat to see it here.</span>
                        )}
                    </li>
                )}
                {!loading && conversations.length > 0 && filtered.length === 0 && (
                    <li className="conversation-sidebar-placeholder">No chats match “{query.trim()}”</li>
                )}
                {filtered.map((c) => {
                    const id = c.id
                    const title = (c.title && String(c.title).trim()) || 'Conversation'
                    const active = selectedId != null && String(selectedId) === String(id)
                    const archived = Boolean(c.archivedAt)
                    const contextBadge = c.contextType === 'STUDENT'
                        ? 'Student'
                        : c.contextType === 'VISIT'
                            ? 'Visit'
                            : null
                    return (
                        <li key={id} className="conversation-sidebar-row">
                            <button
                                type="button"
                                className={`conversation-sidebar-item${active ? ' conversation-sidebar-item--active' : ''}`}
                                disabled={selectDisabled && !active}
                                onClick={() => onSelect?.(id)}
                            >
                                <span className="conversation-sidebar-item-title">
                                    {title}
                                    {contextBadge && (
                                        <span className="conversation-sidebar-context-badge">{contextBadge}</span>
                                    )}
                                </span>
                                <span className="conversation-sidebar-item-meta">
                                    {formatRelativeTime(c.lastTurnAt ?? c.updatedAt)}
                                </span>
                            </button>
                            <div className="conversation-sidebar-actions">
                                <button
                                    type="button"
                                    className="conversation-sidebar-action"
                                    onClick={(e) => handleArchiveAction(e, id, archived)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    title={archived ? 'Unarchive' : 'Archive'}
                                    aria-label={archived ? 'Unarchive conversation' : 'Archive conversation'}
                                >
                                    {archived ? (
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                            <rect x="3" y="4" width="18" height="4" rx="1"/>
                                            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>
                                            <polyline points="9 13 12 10 15 13"/>
                                            <line x1="12" y1="10" x2="12" y2="17"/>
                                        </svg>
                                    ) : (
                                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                            <rect x="3" y="4" width="18" height="4" rx="1"/>
                                            <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8"/>
                                            <line x1="10" y1="12" x2="14" y2="12"/>
                                        </svg>
                                    )}
                                </button>
                                <button
                                    type="button"
                                    className="conversation-sidebar-action conversation-sidebar-action--danger"
                                    onClick={(e) => handleDeleteAction(e, id, title)}
                                    onMouseDown={(e) => e.preventDefault()}
                                    title="Delete"
                                    aria-label="Delete conversation"
                                >
                                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                         strokeWidth="2" aria-hidden="true">
                                        <polyline points="3 6 5 6 21 6"/>
                                        <path
                                            d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                                    </svg>
                                </button>
                            </div>
                        </li>
                    )
                })}
            </ul>
        </aside>
    )
}
