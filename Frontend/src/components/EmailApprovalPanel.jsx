import { useState } from 'react'
import './EmailApprovalPanel.css'

export default function EmailApprovalPanel({ task, onApproval }) {
    const [operatorFeedback, setOperatorFeedback] = useState('')
    const vars = task?.variables || {}

    return (
        <div className="email-approval-panel">
            <div className="email-header">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                    <polyline points="22,6 12,13 2,6" />
                </svg>
                <span className="email-title">Email Approval Required</span>
            </div>

            {vars.instructions && (
                <p className="email-instructions">{vars.instructions}</p>
            )}

            <div className="email-details">
                <div className="email-field">
                    <span className="email-label">To:</span>
                    <span className="email-value">{vars.recipient_name || '—'} &lt;{vars.recipient_email || '—'}&gt;</span>
                </div>
                <div className="email-field">
                    <span className="email-label">Subject:</span>
                    <span className="email-value">{vars.email_subject || '—'}</span>
                </div>
                {vars.email_body && (
                    <div className="email-body-preview">
                        {vars.email_body}
                    </div>
                )}
            </div>

            <div className="email-actions">
                <button className="email-btn approve" onClick={() => onApproval(true, '')}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                    </svg>
                    Approve & Send
                </button>
                <button className="email-btn reject" onClick={() => onApproval(false, operatorFeedback)}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                    Reject
                </button>
            </div>

            <textarea
                className="operator-feedback-input"
                value={operatorFeedback}
                onChange={(e) => setOperatorFeedback(e.target.value)}
                placeholder="Operator feedback (optional, required if rejecting)..."
                rows={2}
            />
        </div>
    )
}
