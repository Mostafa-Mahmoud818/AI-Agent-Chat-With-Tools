import SparkIcon from './SparkIcon'
import './MessageBubble.css'

export default function MessageBubble({ message }) {
    const isAI = message.role === 'ai'
    const isSystem = message.role === 'system'

    if (isSystem) {
        return (
            <div className="message-row system">
                <div className="message-bubble system-bubble">
                    <div className="message-text">{message.text}</div>
                </div>
            </div>
        )
    }

    return (
        <div className={`message-row ${isAI ? 'ai' : 'user'}`}>
            {isAI && (
                <div className="msg-avatar">
                    <SparkIcon size={14} />
                </div>
            )}
            <div className={`message-bubble ${isAI ? 'ai-bubble' : 'user-bubble'}`}>
                <div className="message-text">{message.text}</div>
            </div>
        </div>
    )
}
