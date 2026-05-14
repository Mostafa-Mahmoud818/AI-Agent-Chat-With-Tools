import { describe, it, expect } from 'vitest'
import { bumpConversationLastActivity, sortConversationsForSidebar } from '../conversationSidebarOrder.js'

describe('sortConversationsForSidebar', () => {
    it('orders by lastTurnAt desc when both set', () => {
        const rows = [
            { id: 'a', lastTurnAt: '2026-05-01T10:00:00Z', updatedAt: '2026-05-01T09:00:00Z' },
            { id: 'b', lastTurnAt: '2026-05-06T12:00:00Z', updatedAt: '2026-05-01T08:00:00Z' },
        ]
        const sorted = sortConversationsForSidebar(rows)
        expect(sorted.map((r) => r.id)).toEqual(['b', 'a'])
    })

    it('places rows with lastTurnAt before rows without (NULLS LAST)', () => {
        const rows = [
            { id: 'empty', lastTurnAt: null, updatedAt: '2026-05-10T00:00:00Z' },
            { id: 'active', lastTurnAt: '2026-05-05T00:00:00Z', updatedAt: '2026-05-01T00:00:00Z' },
        ]
        const sorted = sortConversationsForSidebar(rows)
        expect(sorted.map((r) => r.id)).toEqual(['active', 'empty'])
    })

    it('when both lack lastTurnAt, orders by updatedAt desc', () => {
        const rows = [
            { id: 'old', updatedAt: '2026-05-01T00:00:00Z' },
            { id: 'new', updatedAt: '2026-05-08T00:00:00Z' },
        ]
        const sorted = sortConversationsForSidebar(rows)
        expect(sorted.map((r) => r.id)).toEqual(['new', 'old'])
    })
})

describe('bumpConversationLastActivity', () => {
    it('moves bumped conversation to top among peers', () => {
        const rows = [
            { id: 'a', lastTurnAt: '2026-05-10T12:00:00Z', updatedAt: '2026-05-10T12:00:00Z' },
            { id: 'b', lastTurnAt: '2026-05-09T12:00:00Z', updatedAt: '2026-05-09T12:00:00Z' },
        ]
        const next = bumpConversationLastActivity(rows, 'b', '2026-05-11T15:00:00Z')
        expect(next.map((r) => r.id)).toEqual(['b', 'a'])
        const b = next.find((r) => r.id === 'b')
        expect(b.lastTurnAt).toBe('2026-05-11T15:00:00Z')
        expect(b.updatedAt).toBe('2026-05-11T15:00:00Z')
    })

    it('returns copy when id missing (unchanged order)', () => {
        const rows = [{ id: 'a', lastTurnAt: '2026-05-01T00:00:00Z' }]
        const next = bumpConversationLastActivity(rows, 'unknown', '2026-05-20T00:00:00Z')
        expect(next).toEqual(rows)
        expect(next).not.toBe(rows)
    })
})
