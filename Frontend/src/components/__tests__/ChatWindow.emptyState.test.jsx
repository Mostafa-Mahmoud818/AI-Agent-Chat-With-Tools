import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import ChatWindow from '../chat/ChatWindow.jsx'
import { PERSONA_STUDENT, PERSONA_VISIT } from '../../config/personaSession.js'

vi.mock('../../services/api.js', () => ({
    ApiError: class ApiError extends Error {},
    createConversation: vi.fn(),
    createResponseStream: vi.fn(),
    fetchAllConversationTurns: vi.fn(),
    sendReply: vi.fn(),
    SSE_CONCURRENT_STREAMS_ERROR: 'SSE_CONCURRENT',
    startOrchestration: vi.fn(),
}))

vi.mock('../../auth/tokenStore.js', () => ({
    getAccessToken: vi.fn(() => 'tok'),
}))

vi.mock('../../auth/visitResolution.js', () => ({
    tryResolveVisitIdForCurrentUser: vi.fn(async () => null),
}))

const personaMocks = vi.hoisted(() => ({
    resolveActivePersona: vi.fn(() => PERSONA_VISIT),
    hasConfiguredActivePersonaContext: vi.fn(() => true),
    getChatContextForStart: vi.fn(() => ({
        schemaVersion: '1.0',
        contextType: 'VISIT',
        contextData: { id: '11111111-1111-4111-8111-111111111111' },
    })),
    getOtherContextReadonlyMessage: vi.fn(() => 'Other context'),
    getOtherContextComposerPlaceholder: vi.fn(() => 'Other'),
    isOtherContextConversation: vi.fn(() => false),
}))

vi.mock('../../config/personaSession.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ...personaMocks,
    }
})

describe('ChatWindow empty state by persona', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn()
        personaMocks.resolveActivePersona.mockReset()
        personaMocks.hasConfiguredActivePersonaContext.mockReturnValue(true)
        personaMocks.isOtherContextConversation.mockReturnValue(false)
    })

    it('shows visitor empty copy and catering-style prompts', () => {
        personaMocks.resolveActivePersona.mockReturnValue(PERSONA_VISIT)
        render(<ChatWindow />)
        expect(screen.getByText(/Visitor Experience assistant/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /VPN connection/i })).toBeInTheDocument()
        expect(screen.getByText('Visitor persona')).toBeInTheDocument()
    })

    it('shows student empty copy and absence plus Error Banner prompts', () => {
        personaMocks.resolveActivePersona.mockReturnValue(PERSONA_STUDENT)
        render(<ChatWindow />)
        expect(screen.getByText(/submit a new absence request/i)).toBeInTheDocument()
        expect(screen.getByText(/report a Banner registration error/i)).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /submit an absence/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /I got a Banner registration error/i })).toBeInTheDocument()
        expect(screen.getByText('Student persona')).toBeInTheDocument()
    })
})
