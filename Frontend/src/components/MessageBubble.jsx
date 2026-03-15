import { memo } from 'react'
import PropTypes from 'prop-types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import SparkIcon from './SparkIcon'
import './MessageBubble.css'

function stripThinkingTags(text) {
    if (!text) return text
    return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
}

const markdownComponents = {
    a: ({ node, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
}

function MenuItems({ items, onItemClick }) {
    return (
        <div className="menu-items-grid">
            {items.map(item => (
                <button
                    key={item.id}
                    className="menu-card"
                    onClick={() => onItemClick?.(item.label)}
                    title={`Select ${item.label}`}
                >
                    <div className="menu-card-header">
                        <span className="menu-card-label">{item.label}</span>
                        {item.price != null && (
                            <span className="menu-card-price">${Number(item.price).toFixed(2)}</span>
                        )}
                    </div>
                    {item.description && (
                        <span className="menu-card-desc">{item.description}</span>
                    )}
                </button>
            ))}
        </div>
    )
}

function MessageBubble({ message, onMenuItemClick }) {
    const isAI = message.role === 'ai'
    const isSystem = message.role === 'system'
    const hasMenu = isAI && message.payload?.subtype === 'menu' && message.payload?.menuitems?.length > 0

    if (isSystem) {
        return (
            <div className="message-row system" role="status" aria-live="polite">
                <div className="message-bubble system-bubble">
                    <div className="message-text">{message.text}</div>
                </div>
            </div>
        )
    }

    const displayText = isAI ? stripThinkingTags(message.text) : message.text

    return (
        <div className={`message-row ${isAI ? 'ai' : 'user'}`} role="listitem"
             aria-label={isAI ? 'AI response' : 'Your message'}>
            {isAI && (
                <div className="msg-avatar" aria-hidden="true">
                    <SparkIcon size={14} />
                </div>
            )}
            <div className="message-content">
                <div className={`message-bubble ${isAI ? 'ai-bubble' : 'user-bubble'}`}>
                    {isAI ? (
                        <div className="message-text markdown-body">
                            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                {displayText}
                            </ReactMarkdown>
                        </div>
                    ) : (
                        <div className="message-text">{displayText}</div>
                    )}
                    {hasMenu && (
                        <MenuItems items={message.payload.menuitems} onItemClick={onMenuItemClick} />
                    )}
                </div>
                {isAI && message.handledBy && (
                    <span className="handled-by">Answered by {message.handledBy}</span>
                )}
            </div>
        </div>
    )
}

MessageBubble.propTypes = {
    message: PropTypes.shape({
        id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        role: PropTypes.oneOf(['user', 'ai', 'system']).isRequired,
        text: PropTypes.string.isRequired,
        handledBy: PropTypes.string,
        timestamp: PropTypes.instanceOf(Date),
        payload: PropTypes.shape({
            subtype: PropTypes.string,
            menuitems: PropTypes.arrayOf(PropTypes.shape({
                id: PropTypes.string,
                label: PropTypes.string,
                description: PropTypes.string,
                price: PropTypes.number,
            })),
        }),
    }).isRequired,
    onMenuItemClick: PropTypes.func,
}

export default memo(MessageBubble)
