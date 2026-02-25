import { useState, useRef } from 'react'
import './ChatInput.css'

export default function ChatInput({ onSend, placeholder }) {
    const [text, setText] = useState('')
    const inputRef = useRef(null)

    const handleSubmit = (e) => {
        e.preventDefault()
        const trimmed = text.trim()
        if (!trimmed) return
        onSend(trimmed)
        setText('')
        inputRef.current?.focus()
    }

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSubmit(e)
        }
    }

    return (
        <form className="chat-input-form" onSubmit={handleSubmit}>
            <div className="chat-input-wrapper">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={1}
                    autoFocus
                />
                <button
                    type="submit"
                    className={`send-btn ${text.trim() ? 'active' : ''}`}
                    disabled={!text.trim()}
                    aria-label="Send message"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                </button>
            </div>
        </form>
    )
}
