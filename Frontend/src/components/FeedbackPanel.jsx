import { useState } from 'react'
import './FeedbackPanel.css'

export default function FeedbackPanel({ onFeedback }) {
    const [followUpText, setFollowUpText] = useState('')
    const [showFollowUp, setShowFollowUp] = useState(false)

    const handleSatisfied = () => {
        onFeedback(true, '')
    }

    const handleFollowUp = () => {
        if (!showFollowUp) {
            setShowFollowUp(true)
            return
        }
        if (followUpText.trim()) {
            onFeedback(false, followUpText.trim())
        }
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleFollowUp()
        }
    }

    return (
        <div className="feedback-panel">
            <p className="feedback-question">Are you satisfied with this response?</p>

            <div className="feedback-actions">
                <button className="feedback-btn satisfied" onClick={handleSatisfied}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Yes, I'm satisfied
                </button>
                <button className="feedback-btn follow-up" onClick={handleFollowUp}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                    {showFollowUp ? 'Send follow-up' : 'Follow up'}
                </button>
            </div>

            {showFollowUp && (
                <div className="follow-up-input-wrapper">
                    <textarea
                        className="follow-up-input"
                        value={followUpText}
                        onChange={(e) => setFollowUpText(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="What else would you like to know?"
                        rows={2}
                        autoFocus
                    />
                </div>
            )}
        </div>
    )
}
