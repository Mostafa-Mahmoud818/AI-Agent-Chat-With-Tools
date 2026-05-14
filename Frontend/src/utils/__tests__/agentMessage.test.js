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
            payload: { subtype: 'menu', menuitems: [{ id: '1', name: 'Soup', price: 5 }] },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('Here you go')
        expect(payload?.subtype).toBe('menu')
        expect(payload?.menuitems?.[0]?.label).toBe('Soup')
    })

    it('passes through selectionSignal from enriched backend menuitems', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Pick one',
            payload: {
                subtype: 'menu',
                menuitems: [
                    {
                        id: 'c1',
                        name: 'Drinks',
                        selectionSignal: '[catering-menu] Selected Category (name: Drinks) (id: c1)',
                    },
                ],
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.menuitems?.[0]?.selectionSignal).toBe(
            '[catering-menu] Selected Category (name: Drinks) (id: c1)',
        )
    })

    it('preserves product fields (code, status) and drops nameAr on menu items', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Here are the products',
            payload: {
                subtype: 'menu',
                menuitems: [
                    { id: 'p1', name: 'Cold Water', nameAr: 'ماء', code: '999', price: 0, status: 'AVAILABLE' },
                ],
                order: null,
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.subtype).toBe('menu')
        const item = payload?.menuitems?.[0]
        expect(item?.label).toBe('Cold Water')
        expect(item?.code).toBe('999')
        expect(item?.status).toBe('AVAILABLE')
        expect(item?.price).toBe(0)
        expect(item?.nameAr).toBeUndefined()
    })

    it('preserves categoryId on subcategory menu items', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Subcategories',
            payload: {
                subtype: 'menu',
                menuitems: [
                    { id: 's1', name: 'Cold Drinks', categoryId: 'cat-1', description: 'Cold' },
                ],
                order: null,
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.menuitems?.[0]?.categoryId).toBe('cat-1')
        expect(payload?.menuitems?.[0]?.code).toBeNull()
    })

    it('preserves error subtype verbatim', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: '',
            payload: { subtype: 'error', menuitems: [], order: null },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('')
        expect(payload?.subtype).toBe('error')
        expect(payload?.menuitems).toEqual([])
        expect(payload?.order).toBeNull()
    })

    it('strips markdown code fences before parsing JSON', () => {
        const inner = { replyType: 'json', textString: 'Hi', payload: { subtype: 'none', menuitems: [], order: null } }
        const fenced = '```json\n' + JSON.stringify(inner) + '\n```'
        const { text, payload } = parseAgentMessage(fenced)
        expect(text).toBe('Hi')
        // subtype none → payload discarded
        expect(payload).toBeNull()
    })

    it('strips plain code fences (no language tag)', () => {
        const inner = { replyType: 'text', textString: 'Hello there', payload: { subtype: 'none', menuitems: [], order: null } }
        const fenced = '```\n' + JSON.stringify(inner) + '\n```'
        const { text, payload } = parseAgentMessage(fenced)
        expect(text).toBe('Hello there')
        expect(payload).toBeNull()
    })

    it('returns null payload for subtype none', () => {
        const raw = JSON.stringify({
            replyType: 'text',
            textString: 'What would you like to order?',
            payload: { subtype: 'none', menuitems: [], order: null },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('What would you like to order?')
        expect(payload).toBeNull()
    })

    it('normalizes payload.breadcrumb on menu replies (trims, drops invalid entries)', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Here is Cold',
            payload: {
                subtype: 'menu',
                menuitems: [{ id: 'p1', name: 'Juice', code: '1', price: 5 }],
                breadcrumb: [
                    { label: '  Menu ', levelKey: ' root ' },
                    { label: 'Drinks', levelKey: 'cat/1' },
                    { label: '', levelKey: 'sub/bad' }, // dropped
                    { label: 'Cold', levelKey: 'sub/2' },
                ],
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.breadcrumb).toEqual([
            { label: 'Menu', levelKey: 'root' },
            { label: 'Drinks', levelKey: 'cat/1' },
            { label: 'Cold', levelKey: 'sub/2' },
        ])
    })

    it('sets breadcrumb to null when payload omits it', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'menu',
            payload: { subtype: 'menu', menuitems: [{ id: '1', name: 'A' }] },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.breadcrumb).toBeNull()
    })

    it('parses IT/F&M unified menu JSON (textString, menuitems, breadcrumb, ticket fields null)', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Here are IT support areas.',
            payload: {
                subtype: 'menu',
                menuitems: [
                    {
                        id: 'area-1',
                        name: 'Network',
                        description: 'Connectivity',
                        price: null,
                        categoryId: null,
                        status: null,
                        code: null,
                    },
                ],
                breadcrumb: [{ label: 'IT Support', levelKey: 'root' }],
                order: null,
                ticketId: null,
                ticketStatus: null,
            },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('Here are IT support areas.')
        expect(payload?.subtype).toBe('menu')
        expect(payload?.menuitems?.[0]?.label).toBe('Network')
        expect(payload?.breadcrumb).toEqual([{ label: 'IT Support', levelKey: 'root' }])
    })

    it('parses ticket reply with textString and subtype ticket', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Your ticket was created.',
            payload: {
                subtype: 'ticket',
                menuitems: [],
                breadcrumb: [],
                order: null,
                ticketId: 'TK-99',
                ticketStatus: 'OPEN',
            },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('Your ticket was created.')
        expect(payload?.subtype).toBe('ticket')
        expect(payload?.ticketId).toBe('TK-99')
    })

    it('recovers flattened JSON where payload fields are at top level (IT/F&M old-prompt bug)', () => {
        // Bug shape: LLM emits payload="menu" and floats menuitems/breadcrumb to top level.
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Please choose an IT support area.',
            payload: 'menu',
            menuitems: [
                { id: 'area-1', name: 'Network', description: 'Connectivity issues' },
                { id: 'area-2', name: 'Hardware', description: 'Device and peripheral faults' },
            ],
            breadcrumb: [{ label: 'IT Support', levelKey: 'root' }],
            order: null,
            ticketId: null,
            ticketStatus: null,
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('Please choose an IT support area.')
        expect(payload?.subtype).toBe('menu')
        expect(payload?.menuitems).toHaveLength(2)
        expect(payload?.breadcrumb).toEqual([{ label: 'IT Support', levelKey: 'root' }])
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

    it('maps FACILITIES_MAINTENANCE routeCategory on agent message', () => {
        const turns = [
            {
                id: 'fm1',
                userInput: 'AC broken',
                agentResponse: 'I will list service areas.',
                routeCategory: 'FACILITIES_MAINTENANCE',
                createdAt: '2025-01-01T12:00:00Z',
                updatedAt: '2025-01-01T12:00:01Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        expect(msgs).toHaveLength(2)
        expect(msgs[1].handledBy).toBe('FACILITIES_MAINTENANCE')
    })

    it('skips empty agent response', () => {
        const turns = [{ id: 'b1', userInput: 'Q', agentResponse: '   ', createdAt: '2025-01-01T12:00:00Z' }]
        expect(turnsToMessages(turns)).toHaveLength(1)
    })

    it('returns empty array for empty input', () => {
        expect(turnsToMessages([])).toEqual([])
        expect(turnsToMessages(null)).toEqual([])
    })

    it('maps displayText from turn to user message', () => {
        const turns = [
            {
                id: 'c1',
                userInput: '[catering-menu] Selected category "Drinks" (id: 05d5752f).',
                displayText: 'Drinks',
                agentResponse: 'Here are the subcategories.',
                routeCategory: 'CATERING',
                createdAt: '2025-01-01T12:00:00Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        const userMsg = msgs.find((m) => m.role === 'user')
        expect(userMsg.displayText).toBe('Drinks')
        expect(userMsg.text).toBe('[catering-menu] Selected category "Drinks" (id: 05d5752f).')
    })

    it('sets displayText to null when turn has no displayText', () => {
        const turns = [
            {
                id: 'd1',
                userInput: 'Hello',
                agentResponse: 'Hi there.',
                routeCategory: 'CATERING',
                createdAt: '2025-01-01T12:00:00Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        const userMsg = msgs.find((m) => m.role === 'user')
        expect(userMsg.displayText).toBeNull()
    })
})
