import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ChatLayout from '../layout/ChatLayout.jsx'
import * as api from '../../services/api.js'
import { clearTokens, setTokens } from '../../auth/tokenStore.js'

vi.mock('../../services/api', () => ({
    ApiError: class ApiError extends Error {
        constructor(status, errorCode, message) {
            super(message)
            this.status = status
            this.errorCode = errorCode
        }
    },
    archiveConversation: vi.fn(),
    deleteConversation: vi.fn(),
    loadAllConversations: vi.fn(),
    unarchiveConversation: vi.fn(),
}))

vi.mock('../chat/ChatWindow.jsx', () => ({
    default: ({ headerAccessory }) => <div data-testid="chat-window">{headerAccessory}</div>,
}))

vi.mock('../layout/PersonaPicker.jsx', () => ({
    default: () => <div>persona-picker</div>,
}))

vi.mock('../auth/LocalAuthDialog.jsx', () => ({
    default: () => <div>sign-in-dialog</div>,
}))

vi.mock('../../auth/visitResolution.js', () => ({
    tryResolveVisitIdForCurrentUser: vi.fn(async () => null),
}))

vi.mock('../../auth/studentResolution.js', () => ({
    tryResolveDxpUserIdForCurrentUser: vi.fn(async () => null),
}))

vi.mock('../../config/personaSession.js', () => ({
    ensureActivePersona: vi.fn(() => 'VISITOR'),
    isOtherContextConversation: vi.fn(() => false),
}))

describe('ChatLayout', () => {
    let activeRows
    let archivedRows

    beforeEach(() => {
        setTokens({ accessToken: 'tok' })
        activeRows = [{ id: 'a1', title: 'Active one' }]
        archivedRows = [{ id: 'r1', title: 'Restore me', archivedAt: '2026-01-01T00:00:00Z' }]
        vi.mocked(api.loadAllConversations).mockReset()
        vi.mocked(api.unarchiveConversation).mockReset()
        vi.mocked(api.loadAllConversations).mockImplementation(async ({ archived }) => (
            archived ? archivedRows : activeRows
        ))
    })

    it('a late reload after unarchive fetches the view the user toggled back to (M7)', async () => {
        let resolveUnarchive
        vi.mocked(api.unarchiveConversation).mockImplementation(() => new Promise((r) => {
            resolveUnarchive = r
        }))

        render(<ChatLayout />)
        await waitFor(() => expect(screen.getByText('Active one')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: 'Show archived conversations' }))
        await waitFor(() => expect(screen.getByText('Restore me')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: 'Unarchive conversation' }))
        await waitFor(() => expect(api.unarchiveConversation).toHaveBeenCalledWith('r1'))

        // Toggle back before the unarchive request resolves.
        fireEvent.click(screen.getByRole('button', { name: 'Show active conversations' }))
        await waitFor(() => expect(screen.getByText('Active one')).toBeInTheDocument())

        // Server applies the unarchive, then the request resolves → silent reload.
        activeRows = [{ id: 'a1', title: 'Active one' }, { id: 'r1', title: 'Restore me' }]
        archivedRows = []
        await act(async () => {
            resolveUnarchive()
        })

        await waitFor(() => expect(screen.getByText('Restore me')).toBeInTheDocument())
        expect(screen.getByText('Active one')).toBeInTheDocument()
        expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument()
        const calls = vi.mocked(api.loadAllConversations).mock.calls
        expect(calls[calls.length - 1][0]).toMatchObject({ archived: false })
    })

    it('ignores a list response for a view the user has already left', async () => {
        let resolveArchived
        vi.mocked(api.loadAllConversations).mockImplementation(({ archived }) => (
            archived
                ? new Promise((r) => {
                    resolveArchived = () => r(archivedRows)
                })
                : Promise.resolve(activeRows)
        ))

        render(<ChatLayout />)
        await waitFor(() => expect(screen.getByText('Active one')).toBeInTheDocument())

        fireEvent.click(screen.getByRole('button', { name: 'Show archived conversations' }))
        await waitFor(() => expect(resolveArchived).toBeTypeOf('function'))
        fireEvent.click(screen.getByRole('button', { name: 'Show active conversations' }))
        await waitFor(() => expect(screen.getByText('Active one')).toBeInTheDocument())

        await act(async () => {
            resolveArchived()
        })

        expect(screen.queryByText('Restore me')).not.toBeInTheDocument()
        expect(screen.getByText('Active one')).toBeInTheDocument()
    })

    it('clears the search text when switching views', async () => {
        render(<ChatLayout />)
        await waitFor(() => expect(screen.getByText('Active one')).toBeInTheDocument())

        const search = screen.getByRole('searchbox', { name: 'Search conversations' })
        fireEvent.change(search, { target: { value: 'zzz' } })
        expect(search).toHaveValue('zzz')

        fireEvent.click(screen.getByRole('button', { name: 'Show archived conversations' }))
        await waitFor(() => expect(screen.getByText('Restore me')).toBeInTheDocument())
        expect(screen.getByRole('searchbox', { name: 'Search conversations' })).toHaveValue('')
    })

    it('drops to signed-out state when the tokens are cleared (M4)', async () => {
        render(<ChatLayout />)
        await waitFor(() => expect(screen.getByText('Active one')).toBeInTheDocument())
        expect(screen.getByText('persona-picker')).toBeInTheDocument()

        act(() => {
            clearTokens()
        })

        await waitFor(() => expect(screen.queryByText('persona-picker')).not.toBeInTheDocument())
        expect(screen.queryByText('Active one')).not.toBeInTheDocument()
    })
})
