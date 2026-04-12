import { describe, it, expect } from 'vitest'
import { parseAgentMessage, turnsToMessages } from '../agentMessage.js'

describe('parseAgentMessage', () => {
    it('returns raw text when not JSON', () => {
        const { text, payload } = parseAgentMessage('hello')
        expect(text).toBe('hello')
        expect(payload).toBeNull()
    })

    it('extracts structured catering-style payload', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Here you go',
            payload: { items: [1] },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('Here you go')
        expect(payload).toEqual({ items: [1] })
    })
})

describe('turnsToMessages', () => {
    it('maps user and agent rows from turns', () => {
        const turns = [
            {
                id: 'a1',
                userInput: 'Hi',
                agentResponse: 'Hello',
                routeCategory: 'CATERING',
                createdAt: '2025-01-01T12:00:00Z',
                updatedAt: '2025-01-01T12:00:01Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        expect(msgs).toHaveLength(2)
        expect(msgs[0].role).toBe('user')
        expect(msgs[0].text).toBe('Hi')
        expect(msgs[1].role).toBe('ai')
        expect(msgs[1].text).toBe('Hello')
        expect(msgs[1].handledBy).toBe('CATERING')
    })

    it('skips empty agent response', () => {
        const turns = [{ id: 'b1', userInput: 'Q', agentResponse: '   ', createdAt: '2025-01-01T12:00:00Z' }]
        expect(turnsToMessages(turns)).toHaveLength(1)
    })

    it('returns empty array for empty input', () => {
        expect(turnsToMessages([])).toEqual([])
        expect(turnsToMessages(null)).toEqual([])
    })
})
