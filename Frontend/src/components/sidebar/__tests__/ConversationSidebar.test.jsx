import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ConversationSidebar from '../ConversationSidebar.jsx'

describe('ConversationSidebar new-chat button', () => {
    it('is enabled and clickable by default', () => {
        const onNewChat = vi.fn()
        render(<ConversationSidebar conversations={[]} onNewChat={onNewChat} />)

        const btn = screen.getByRole('button', { name: /start new conversation/i })
        expect(btn).not.toBeDisabled()
        fireEvent.click(btn)
        expect(onNewChat).toHaveBeenCalledTimes(1)
    })

    it('is disabled and not clickable when newChatDisabled is true', () => {
        const onNewChat = vi.fn()
        render(<ConversationSidebar conversations={[]} onNewChat={onNewChat} newChatDisabled />)

        const btn = screen.getByRole('button', { name: /start new conversation/i })
        expect(btn).toBeDisabled()
        fireEvent.click(btn)
        expect(onNewChat).not.toHaveBeenCalled()
    })
})

describe('ConversationSidebar conversation select', () => {
    const conversations = [
        { id: 'a', title: 'Chat A', lastTurnAt: '2026-01-01T00:00:00Z' },
        { id: 'b', title: 'Chat B', lastTurnAt: '2026-01-01T00:00:00Z' },
    ]

    it('selects another conversation when selectDisabled is false', () => {
        const onSelect = vi.fn()
        render(
            <ConversationSidebar
                conversations={conversations}
                selectedId="a"
                onSelect={onSelect}
            />,
        )
        fireEvent.click(screen.getByRole('button', { name: /Chat B/i }))
        expect(onSelect).toHaveBeenCalledWith('b')
    })

    it('does not select a different conversation when selectDisabled is true', () => {
        const onSelect = vi.fn()
        render(
            <ConversationSidebar
                conversations={conversations}
                selectedId="a"
                onSelect={onSelect}
                selectDisabled
            />,
        )
        const other = screen.getByRole('button', { name: /Chat B/i })
        expect(other).toBeDisabled()
        fireEvent.click(other)
        expect(onSelect).not.toHaveBeenCalled()
        expect(screen.getByRole('button', { name: /Chat A/i })).not.toBeDisabled()
    })
})
