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

function MessageBubble({ message }) {
    const isAI = message.role === 'ai'
    const isSystem = message.role === 'system'

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
    }).isRequired,
}

export default memo(MessageBubble)
