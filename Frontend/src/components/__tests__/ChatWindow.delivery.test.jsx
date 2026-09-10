import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import ChatWindow from '../chat/ChatWindow.jsx'
import { PERSONA_VISIT } from '../../config/personaSession.js'
import * as api from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
    ApiError: class ApiError extends Error {
        constructor(status, errorCode, message) {
            super(message)
            this.status = status
            this.errorCode = errorCode
        }
    },
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

function mockStreamController() {
    const handlers = {
        onmessage: null,
        onerror: null,
        onclosedWithoutTerminal: null,
        readyState: 1,
        close: vi.fn(function close() {
            this.readyState = 2
        }),
    }
    return handlers
}

describe('ChatWindow round order and send guard', () => {
    beforeEach(() => {
        Element.prototype.scrollIntoView = vi.fn()
        personaMocks.resolveActivePersona.mockReturnValue(PERSONA_VISIT)
        personaMocks.hasConfiguredActivePersonaContext.mockReturnValue(true)
        vi.mocked(api.createConversation).mockReset()
        vi.mocked(api.createResponseStream).mockReset()
        vi.mocked(api.fetchAllConversationTurns).mockReset()
        vi.mocked(api.sendReply).mockReset()
        vi.mocked(api.startOrchestration).mockReset()
        vi.mocked(api.fetchAllConversationTurns).mockResolvedValue([])
    })

    it('awaits POST before opening the stream (POST-then-stream)', async () => {
        const order = []
        let resolvePost
        const postPromise = new Promise((r) => {
            resolvePost = r
        })
        const stream = mockStreamController()

        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockImplementation(async () => {
            order.push('post')
            await postPromise
            return {}
        })
        vi.mocked(api.createResponseStream).mockImplementation(() => {
            order.push('stream')
            return stream
        })

        render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })

        await waitFor(() => expect(api.startOrchestration).toHaveBeenCalled())
        expect(order).toEqual(['post'])
        expect(api.createResponseStream).not.toHaveBeenCalled()

        await act(async () => {
            resolvePost({})
        })
        await waitFor(() => expect(api.createResponseStream).toHaveBeenCalledWith('c1'))
        expect(order).toEqual(['post', 'stream'])
    })

    it('does not open a stream when POST fails', async () => {
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockRejectedValue(
            new api.ApiError(500, 'server', 'boom'),
        )
        vi.mocked(api.createResponseStream).mockImplementation(() => mockStreamController())

        render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })

        await waitFor(() => expect(api.startOrchestration).toHaveBeenCalled())
        expect(api.createResponseStream).not.toHaveBeenCalled()
        await waitFor(() => {
            expect(screen.queryByText('Hello')).not.toBeInTheDocument()
        })
    })

    it('ignores duplicate terminal ready frames (exactly one AI bubble)', async () => {
        const stream = mockStreamController()
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockResolvedValue({})
        vi.mocked(api.createResponseStream).mockReturnValue(stream)

        render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(stream.onmessage).toBeTypeOf('function'))

        const ready = {
            status: 'ready',
            message: JSON.stringify({ replyType: 'text', textString: 'Answer once' }),
            handledBy: 'FRONT_DOOR',
        }
        await act(async () => {
            stream.onmessage({ data: JSON.stringify(ready) })
            stream.onmessage({ data: JSON.stringify(ready) })
        })

        expect(screen.getAllByText('Answer once')).toHaveLength(1)
    })

    it('does not apply a second send while the first round is in flight', async () => {
        let resolvePost
        const postPromise = new Promise((r) => {
            resolvePost = r
        })
        const stream = mockStreamController()
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockImplementation(async () => {
            await postPromise
            return {}
        })
        vi.mocked(api.createResponseStream).mockReturnValue(stream)

        render(<ChatWindow />)
        const prompt = screen.getByRole('button', { name: /what can you do/i })
        await act(async () => {
            fireEvent.click(prompt)
            fireEvent.click(prompt)
        })

        await waitFor(() => expect(api.createConversation).toHaveBeenCalledTimes(1))
        expect(api.startOrchestration).toHaveBeenCalledTimes(1)

        await act(async () => {
            resolvePost({})
        })
    })

    it('disables the New Chat button while a round is in flight', async () => {
        let resolvePost
        const postPromise = new Promise((r) => {
            resolvePost = r
        })
        const stream = mockStreamController()
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockImplementation(async () => {
            await postPromise
            return {}
        })
        vi.mocked(api.createResponseStream).mockReturnValue(stream)

        render(<ChatWindow />)
        const prompt = screen.getByRole('button', { name: /what can you do/i })
        await act(async () => {
            fireEvent.click(prompt)
        })

        await waitFor(() => expect(api.createConversation).toHaveBeenCalledTimes(1))
        const newChatBtn = await screen.findByRole('button', { name: /start new conversation/i })
        expect(newChatBtn).toBeDisabled()

        // Two separate act() flushes: resolving the POST only *schedules* startStreaming (it
        // completes on a later microtask), so `stream.onmessage` isn't wired until that tick runs.
        await act(async () => {
            resolvePost({})
        })
        await act(async () => {
            stream.onmessage?.({ data: JSON.stringify({ status: 'ready', message: JSON.stringify({ replyType: 'text', textString: 'Answer', payload: { subtype: 'none', menuitems: [], order: null } }), handledBy: 'FRONT_DOOR' }) })
        })

        expect(newChatBtn).not.toBeDisabled()
    })

    it('does not apply a cached previous READY (POST completes before stream subscribe)', async () => {
        let postResolved = false
        let resolvePost
        const postPromise = new Promise((r) => {
            resolvePost = r
        })
        const stream = mockStreamController()
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockImplementation(async () => {
            await postPromise
            postResolved = true
            return {}
        })
        vi.mocked(api.createResponseStream).mockImplementation(() => {
            queueMicrotask(() => {
                if (!postResolved) {
                    stream.onmessage?.({
                        data: JSON.stringify({
                            status: 'ready',
                            message: JSON.stringify({ replyType: 'text', textString: 'PREVIOUS ANSWER' }),
                            handledBy: 'FRONT_DOOR',
                        }),
                    })
                }
            })
            return stream
        })

        render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(api.startOrchestration).toHaveBeenCalled())
        expect(screen.queryByText('PREVIOUS ANSWER')).not.toBeInTheDocument()

        await act(async () => {
            resolvePost({})
        })
        await waitFor(() => expect(api.createResponseStream).toHaveBeenCalled())
        expect(screen.queryByText('PREVIOUS ANSWER')).not.toBeInTheDocument()
    })

    it('reconciles the server transcript when the stream closes without a terminal', async () => {
        const stream = mockStreamController()
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockResolvedValue({})
        vi.mocked(api.createResponseStream).mockReturnValue(stream)
        vi.mocked(api.fetchAllConversationTurns).mockResolvedValue([
            {
                id: 't1',
                userInput: 'Hello',
                agentResponse: JSON.stringify({ replyType: 'text', textString: 'Recovered reply' }),
                turnKind: 'EXCHANGE',
                createdAt: '2026-01-01T00:00:00Z',
                routeCategory: 'FRONT_DOOR',
            },
        ])

        render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(stream.onclosedWithoutTerminal).toBeTypeOf('function'))

        await act(async () => {
            stream.onclosedWithoutTerminal()
        })

        await waitFor(() => expect(screen.getByText('Recovered reply')).toBeInTheDocument())
    })

    it('reconciles when SSE ready has an empty message', async () => {
        const stream = mockStreamController()
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c1' })
        vi.mocked(api.startOrchestration).mockResolvedValue({})
        vi.mocked(api.createResponseStream).mockReturnValue(stream)
        vi.mocked(api.fetchAllConversationTurns).mockResolvedValue([
            {
                id: 't1',
                userInput: 'Hello',
                agentResponse: JSON.stringify({ replyType: 'text', textString: 'Recovered from empty ready' }),
                turnKind: 'EXCHANGE',
                createdAt: '2026-01-01T00:00:00Z',
                routeCategory: 'FRONT_DOOR',
            },
        ])

        render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(stream.onmessage).toBeTypeOf('function'))

        await act(async () => {
            stream.onmessage({ data: JSON.stringify({ status: 'ready', message: null, handledBy: 'FRONT_DOOR' }) })
        })

        await waitFor(() => expect(screen.getByText('Recovered from empty ready')).toBeInTheDocument())
    })

    it('does not let a late 409 for conversation A mutate conversation B', async () => {
        let rejectReply
        const replyPromise = new Promise((_, reject) => {
            rejectReply = reject
        })
        vi.mocked(api.fetchAllConversationTurns).mockImplementation(async (id) => {
            if (id === 'conv-a') {
                return [{
                    id: 'ta',
                    userInput: 'from A',
                    agentResponse: JSON.stringify({ replyType: 'text', textString: 'Answer A' }),
                    turnKind: 'EXCHANGE',
                    createdAt: '2026-01-01T00:00:00Z',
                    routeCategory: 'FRONT_DOOR',
                }]
            }
            return [{
                id: 'tb',
                userInput: 'from B',
                agentResponse: JSON.stringify({ replyType: 'text', textString: 'Answer B' }),
                turnKind: 'EXCHANGE',
                createdAt: '2026-01-01T00:00:00Z',
                routeCategory: 'FRONT_DOOR',
            }]
        })
        vi.mocked(api.sendReply).mockImplementation(() => replyPromise)
        vi.mocked(api.createResponseStream).mockReturnValue(mockStreamController())

        const { rerender } = render(<ChatWindow sidebarConversationId="conv-a" />)
        await waitFor(() => expect(screen.getByText('Answer A')).toBeInTheDocument())

        const input = screen.getByPlaceholderText(/follow-up/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'next' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(api.sendReply).toHaveBeenCalled())

        rerender(<ChatWindow sidebarConversationId="conv-b" />)
        await waitFor(() => expect(screen.getByText('Answer B')).toBeInTheDocument())

        await act(async () => {
            rejectReply(new api.ApiError(409, 'conflict', 'busy'))
        })

        expect(screen.queryByText('Answer A')).not.toBeInTheDocument()
        expect(screen.getByText('Answer B')).toBeInTheDocument()
    })

    it('opens the follow-up stream only after user-messages POST resolves', async () => {
        const order = []
        let resolvePost
        const postPromise = new Promise((r) => {
            resolvePost = r
        })
        const stream = mockStreamController()
        vi.mocked(api.fetchAllConversationTurns).mockResolvedValue([{
            id: 't1',
            userInput: 'Hi',
            agentResponse: JSON.stringify({ replyType: 'text', textString: 'Welcome' }),
            turnKind: 'EXCHANGE',
            createdAt: '2026-01-01T00:00:00Z',
            routeCategory: 'FRONT_DOOR',
        }])
        vi.mocked(api.sendReply).mockImplementation(async () => {
            order.push('post')
            await postPromise
        })
        vi.mocked(api.createResponseStream).mockImplementation(() => {
            order.push('stream')
            return stream
        })

        render(<ChatWindow sidebarConversationId="c-follow" />)
        await waitFor(() => expect(screen.getByText('Welcome')).toBeInTheDocument())

        const input = screen.getByPlaceholderText(/follow-up/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'More' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(api.sendReply).toHaveBeenCalled())
        expect(order).toEqual(['post'])

        await act(async () => {
            resolvePost()
        })
        await waitFor(() => expect(api.createResponseStream).toHaveBeenCalledWith('c-follow'))
        expect(order).toEqual(['post', 'stream'])
    })

    it('does not open a stream when unmounted during POST', async () => {
        let resolvePost
        const postPromise = new Promise((r) => {
            resolvePost = r
        })
        vi.mocked(api.createConversation).mockResolvedValue({ conversationId: 'c-unmount' })
        vi.mocked(api.startOrchestration).mockImplementation(async () => {
            await postPromise
            return {}
        })
        vi.mocked(api.createResponseStream).mockReturnValue(mockStreamController())

        const { unmount } = render(<ChatWindow />)
        const input = screen.getByPlaceholderText(/type your message/i)
        await act(async () => {
            fireEvent.change(input, { target: { value: 'Hello' } })
            fireEvent.submit(input.closest('form'))
        })
        await waitFor(() => expect(api.startOrchestration).toHaveBeenCalled())

        unmount()
        await act(async () => {
            resolvePost({})
        })
        expect(api.createResponseStream).not.toHaveBeenCalled()
    })
})
