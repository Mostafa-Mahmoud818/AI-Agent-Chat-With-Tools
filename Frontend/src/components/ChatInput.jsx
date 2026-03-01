import { useState, useRef, useCallback, forwardRef, useImperativeHandle } from 'react'
import PropTypes from 'prop-types'
import './ChatInput.css'

/**
 * Chat text input component.
 * Exposes a `focus()` method via forwardRef so parents can programmatically
 * focus the textarea without resorting to document.querySelector.
 */
const ChatInput = forwardRef(function ChatInput({ onSend, placeholder, disabled }, ref) {
    const [text, setText] = useState('')
    const inputRef = useRef(null)

    // Expose focus() to parent via ref
    useImperativeHandle(ref, () => ({
        focus() {
            inputRef.current?.focus()
        }
    }), [])

    const canSend = text.trim() && !disabled

    const handleInput = useCallback((e) => {
        setText(e.target.value)
        e.target.style.height = 'auto'
        e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
    }, [])

    const submit = useCallback(() => {
        const trimmed = text.trim()
        if (!trimmed || disabled) return
        onSend(trimmed)
        setText('')
        if (inputRef.current) {
            inputRef.current.style.height = 'auto'
            inputRef.current.focus()
        }
    }, [text, disabled, onSend])

    const handleSubmit = useCallback((e) => {
        e.preventDefault()
        submit()
    }, [submit])

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }, [submit])

    return (
        <form className="chat-input-form" onSubmit={handleSubmit}>
            <div className="chat-input-wrapper">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={text}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={1}
                    disabled={disabled}
                    autoFocus
                />
                <button
                    type="submit"
                    className={`send-btn ${canSend ? 'active' : ''}`}
                    disabled={!canSend}
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
})

ChatInput.propTypes = {
    onSend: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    disabled: PropTypes.bool,
}

export default ChatInput
