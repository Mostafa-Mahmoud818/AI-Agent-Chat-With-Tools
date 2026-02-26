import SparkIcon from './SparkIcon'
import './ThinkingIndicator.css'

export default function ThinkingIndicator() {
    return (
        <div className="thinking-row">
            <div className="msg-avatar thinking-avatar">
                <SparkIcon size={14} />
            </div>
            <div className="thinking-bubble">
                <div className="thinking-dots">
                    <span className="dot" />
                    <span className="dot" />
                    <span className="dot" />
                </div>
            </div>
        </div>
    )
}
