import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import MessageBubble from '../MessageBubble'

describe('MessageBubble', () => {
    it('renders user message as plain text', () => {
        const msg = { id: 'u1', role: 'user', text: 'Hello world', timestamp: new Date() }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Hello world')).toBeInTheDocument()
        expect(screen.getByRole('listitem')).toHaveAttribute('aria-label', 'Your message')
    })

    it('renders AI message with markdown', () => {
        const msg = { id: 'a1', role: 'ai', text: '**Bold text**', timestamp: new Date(), handledBy: 'General Agent' }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Bold text')).toBeInTheDocument()
        expect(screen.getByText('Answered by General Agent')).toBeInTheDocument()
    })

    it('renders system message with status role', () => {
        const msg = { id: 's1', role: 'system', text: 'Session expired', timestamp: new Date() }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Session expired')).toBeInTheDocument()
        expect(screen.getByRole('status')).toBeInTheDocument()
    })

    it('strips thinking tags from AI messages', () => {
        const msg = { id: 'a2', role: 'ai', text: '<thinking><context>test</context></thinking>The answer is 42.', timestamp: new Date() }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('The answer is 42.')).toBeInTheDocument()
        expect(screen.queryByText('test')).not.toBeInTheDocument()
    })

    it('renders markdown links with safe attributes', () => {
        const msg = { id: 'a3', role: 'ai', text: '[Click here](https://example.com)', timestamp: new Date() }
        render(<MessageBubble message={msg} />)
        const link = screen.getByText('Click here')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })
})
