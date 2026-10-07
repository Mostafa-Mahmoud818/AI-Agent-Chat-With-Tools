import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import ChatWindow from '../chat/ChatWindow.jsx'
import { PERSONA_STUDENT, PERSONA_VISIT } from '../../config/personaSession.js'
import * as api from '../../services/api.js'
import { getAccessToken } from '../../auth/tokenStore.js'

vi.mock('../../services/api.js', () => ({
    ApiError: class ApiError extends Error {},
    createConversation: vi.fn(),
    createResponseStream: vi.fn(),
    fetchAllConversationTurns: vi.fn(),
    sendReply: vi.fn(),
    SSE_CONCURRENT_STREAMS_ERROR: 'SSE_CONCURRENT',
    startOrchestration: vi.fn(),
    getRequestTypes: vi.fn(async () => []),
}))

vi.mock('../../auth/tokenStore.js', () => ({
    getAccessToken: vi.fn(() => 'tok'),
}))

vi.mock('../../auth/visitResolution.js', () => ({
    tryResolveVisitIdForCurrentUser: vi.fn(async () => null),
}))

vi.mock('../../auth/studentResolution.js', () => ({
    tryResolveDxpUserIdForCurrentUser: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
    tryResolveStudentIdForCurrentUser: vi.fn(async () => null),
}))

const personaMocks = vi.hoisted(() => ({
    resolveActivePersona: vi.fn(() => PERSONA_VISIT),
    hasConfiguredActivePersonaContext: vi.fn(() => true),
    getChatContextForStart: vi.fn(() => ({
        schemaVersion: '1.0',
        contextType: 'VISITOR',
        userId: '11111111-1111-4111-8111-111111111111',
        contextData: { visitId: '22222222-2222-4222-8222-222222222222' },
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

/** Unsigned JWT carrying the given persona_code claim. */
function tokenFor(personaCode) {
    const payload = btoa(JSON.stringify({ sub: 'u', persona_code: personaCode }))
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    return `e30.${payload}.sig`
}

const STUDENT_TYPES = [
    { key: 'student_absence', label: 'Absence Request', templatePrompt: 'I need to report an absence', icon: null },
    { key: 'banner_error', label: 'Report Error', templatePrompt: 'I want to report an error', icon: null },
]

describe('ChatWindow empty state', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn()
        personaMocks.resolveActivePersona.mockReset()
        personaMocks.hasConfiguredActivePersonaContext.mockReturnValue(true)
        personaMocks.isOtherContextConversation.mockReturnValue(false)
        vi.mocked(api.getRequestTypes).mockReset()
        vi.mocked(api.getRequestTypes).mockResolvedValue([])
        vi.mocked(getAccessToken).mockReturnValue('tok')
    })

    it('shows only the request-type cards section for the token persona', async () => {
        personaMocks.resolveActivePersona.mockReturnValue(PERSONA_STUDENT)
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockResolvedValue(STUDENT_TYPES)

        render(<ChatWindow />)

        expect(await screen.findByText('What are you looking for?')).toBeInTheDocument()
        expect(screen.getByText('Ask a question or start a request.')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Absence Request/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Report Error/i })).toBeInTheDocument()
        expect(screen.getByText('Student persona')).toBeInTheDocument()
    })

    it.each([
        ['visitor', PERSONA_VISIT],
        ['student', PERSONA_STUDENT],
    ])('no longer shows the welcome headline, description or quick prompts (%s)', async (_, persona) => {
        personaMocks.resolveActivePersona.mockReturnValue(persona)

        render(<ChatWindow />)

        await waitFor(() => expect(screen.getByRole('list', { name: /Chat messages/i })).toBeInTheDocument())
        expect(screen.queryByText(/How can I help you today\?/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/Visitor Experience assistant/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/submit a new absence request/i)).not.toBeInTheDocument()
        expect(screen.queryByRole('button', { name: /What can you do\?/i })).not.toBeInTheDocument()
        expect(screen.queryByText('My studies')).not.toBeInTheDocument()
    })

    it('still shows the sign-in context hint when the persona context is missing', () => {
        personaMocks.resolveActivePersona.mockReturnValue(PERSONA_STUDENT)
        personaMocks.hasConfiguredActivePersonaContext.mockReturnValue(false)

        render(<ChatWindow />)

        expect(screen.getAllByRole('status').some((el) => el.classList.contains('visit-id-hint'))).toBe(true)
    })
})
