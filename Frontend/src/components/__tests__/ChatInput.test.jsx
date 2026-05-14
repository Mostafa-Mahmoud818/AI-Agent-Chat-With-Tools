import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ChatInput from '../chat/ChatInput'

describe('ChatInput', () => {
    it('calls onSend when form is submitted with text', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Hello' } })
        fireEvent.submit(textarea.closest('form'))
        expect(onSend).toHaveBeenCalledWith('Hello')
    })

    it('does not call onSend when text is empty', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        fireEvent.submit(screen.getByPlaceholderText('Type...').closest('form'))
        expect(onSend).not.toHaveBeenCalled()
    })

    it('sends on Enter key (not Shift+Enter)', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Test message' } })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
        expect(onSend).toHaveBeenCalledWith('Test message')
    })

    it('does not send on Shift+Enter', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Test' } })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
        expect(onSend).not.toHaveBeenCalled()
    })

    it('disables input when disabled prop is true', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} disabled placeholder="Type..." />)
        expect(screen.getByPlaceholderText('Type...')).toBeDisabled()
    })
})
