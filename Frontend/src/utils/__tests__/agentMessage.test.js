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

describe('parseAgentMessage navigation subtypes', () => {
    it('preserves outdoor_navigation object with numeric coordinates (no navigationType field)', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Your destination is at Head Quarter.',
            payload: {
                subtype: 'outdoor_navigation',
                menuitems: [],
                order: null,
                navigation: {
                    locationName: 'Head Quarter',
                    resourceId: 'HQ-001',
                    resourceName: 'Head Quarter',
                    latitude: 24.4473667,
                    longitude: 54.3949106,
                },
            },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('Your destination is at Head Quarter.')
        expect(payload?.subtype).toBe('outdoor_navigation')
        expect(payload?.navigation).toEqual({
            locationName: 'Head Quarter',
            resourceId: 'HQ-001',
            resourceName: 'Head Quarter',
            latitude: 24.4473667,
            longitude: 54.3949106,
        })
    })

    it('forces indoor_navigation coordinates to null and keeps resource fields', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Your meeting is in Meeting Room A3.',
            payload: {
                subtype: 'indoor_navigation',
                menuitems: [],
                order: null,
                navigation: {
                    locationName: 'Building 1',
                    resourceId: 'ROOM-123',
                    resourceName: 'Meeting Room A3',
                    latitude: 24.1,
                    longitude: 54.1,
                },
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.subtype).toBe('indoor_navigation')
        expect(payload?.navigation?.latitude).toBeNull()
        expect(payload?.navigation?.longitude).toBeNull()
        expect(payload?.navigation?.resourceId).toBe('ROOM-123')
        expect(payload?.navigation?.resourceName).toBe('Meeting Room A3')
        expect(payload?.navigation).not.toHaveProperty('navigationType')
    })

    it('defensively parses a navigation payload even if replyType is "text" (not promoted to menu)', () => {
        const raw = JSON.stringify({
            replyType: 'text',
            textString: 'Here is your location.',
            payload: {
                subtype: 'outdoor_navigation',
                menuitems: [],
                order: null,
                navigation: { locationName: 'HQ', resourceId: null, resourceName: null, latitude: 1, longitude: 2 },
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.subtype).toBe('outdoor_navigation')
        expect(payload?.menuitems).toEqual([])
    })
})

describe('parseAgentMessage visits_query subtype', () => {
    it('parses visits_query envelope and normalizes items', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'You have 1 meeting today (UAE time).',
            payload: {
                subtype: 'visits_query',
                menuitems: [],
                order: null,
                navigation: null,
                visits: {
                    scope: 'today',
                    defaultApplied: false,
                    timezone: 'Asia/Dubai',
                    totalCount: 1,
                    page: 0,
                    size: 20,
                    items: [{
                        visitId: '9f4c2d8e-1234-4abc-9def-1234567890ab',
                        title: 'Quarterly Review',
                        status: 'UPCOMING',
                        startLocal: '2026-06-28T10:00:00+04:00',
                        endLocal: '2026-06-28T11:00:00+04:00',
                        hostName: 'Dr. Al Mansoori',
                        resourceName: 'Conference Room',
                        locationName: 'HQ',
                        floorName: 'Floor 4',
                    }],
                },
            },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe('You have 1 meeting today (UAE time).')
        expect(payload?.subtype).toBe('visits_query')
        expect(payload?.visits?.scope).toBe('today')
        expect(payload?.visits?.timezone).toBe('Asia/Dubai')
        expect(payload?.visits?.items).toHaveLength(1)
        expect(payload?.visits?.items[0].title).toBe('Quarterly Review')
        expect(payload?.visits?.items[0].timeDisplay).toBeTruthy()
        expect(payload?.menuitems).toEqual([])
    })

    it('defensively parses visits_query even if replyType is text', () => {
        const raw = JSON.stringify({
            replyType: 'text',
            textString: 'Here are your meetings.',
            payload: {
                subtype: 'visits_query',
                menuitems: [],
                order: null,
                visits: {
                    scope: 'upcoming',
                    defaultApplied: true,
                    timezone: 'Asia/Dubai',
                    totalCount: 0,
                    page: 0,
                    size: 20,
                    items: [],
                },
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.subtype).toBe('visits_query')
        expect(payload?.visits?.items).toEqual([])
    })

    it('drops visit items missing title', () => {
        const raw = JSON.stringify({
            replyType: 'json',
            textString: 'Meetings',
            payload: {
                subtype: 'visits_query',
                visits: {
                    scope: 'today',
                    items: [{ visitId: 'x', title: '  ', status: 'UPCOMING' }, { title: 'Valid Meeting' }],
                },
            },
        })
        const { payload } = parseAgentMessage(raw)
        expect(payload?.visits?.items).toHaveLength(1)
        expect(payload?.visits?.items[0].title).toBe('Valid Meeting')
    })
})

describe('parseAgentMessage previous+upcoming visits listing (subtype none)', () => {
    const listingText = `**Upcoming visits**

1. Vendor Meeting — Tue 15 Jul
2. Team Sync — Wed 16 Jul

**Previous visits**

3. Board Review — Mon 7 Jul

Which visit would you like to know more about?`

    it('preserves text-only listing and discards subtype none payload', () => {
        const raw = JSON.stringify({
            replyType: 'text',
            textString: listingText,
            payload: {
                subtype: 'none',
                menuitems: [],
                order: null,
                navigation: null,
                visits: null,
            },
        })
        const { text, payload } = parseAgentMessage(raw)
        expect(text).toBe(listingText)
        expect(payload).toBeNull()
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

    it('preserves lowercase wire routeCategory from persisted turns (it_support)', () => {
        const turns = [
            {
                id: 'it1',
                userInput: 'VPN issue',
                agentResponse: '{"replyType":"text","textString":"Here are IT areas.","payload":{"subtype":"none"}}',
                routeCategory: 'it_support',
                createdAt: '2025-01-01T12:00:00Z',
                updatedAt: '2025-01-01T12:00:01Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        expect(msgs).toHaveLength(2)
        expect(msgs[1].handledBy).toBe('it_support')
    })

    it('preserves lowercase wire routeCategory visitor_experience on SYSTEM turn', () => {
        const turns = [{
            id: 'vx1',
            turnKind: 'SYSTEM',
            userInput: null,
            agentResponse: '{"replyType":"text","textString":"Visit updated.","payload":{"subtype":"none"}}',
            routeCategory: 'visitor_experience',
            createdAt: '2025-01-01T12:00:00Z',
            updatedAt: '2025-01-01T12:00:00Z',
        }]
        const msgs = turnsToMessages(turns)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].handledBy).toBe('visitor_experience')
    })

    it('skips empty agent response', () => {
        const turns = [{ id: 'b1', userInput: 'Q', agentResponse: '   ', createdAt: '2025-01-01T12:00:00Z' }]
        expect(turnsToMessages(turns)).toHaveLength(1)
    })

    it('renders a SYSTEM turn as a single agent status message (no user bubble)', () => {
        const envelope = JSON.stringify({
            replyType: 'text',
            textString: 'Your Catering request CAT-2026-00042 is now Confirmed.',
            payload: { subtype: 'none' },
        })
        const turns = [{
            id: 's1',
            turnKind: 'SYSTEM',
            userInput: null,
            agentResponse: envelope,
            routeCategory: 'CATERING',
            createdAt: '2025-01-01T12:00:00Z',
            updatedAt: '2025-01-01T12:00:00Z',
        }]

        const msgs = turnsToMessages(turns)

        expect(msgs).toHaveLength(1)
        expect(msgs[0].role).toBe('ai')
        expect(msgs[0].system).toBe(true)
        expect(msgs[0].text).toBe('Your Catering request CAT-2026-00042 is now Confirmed.')
        expect(msgs[0].payload).toBeNull()
    })

    it('returns empty array for empty input', () => {
        expect(turnsToMessages([])).toEqual([])
        expect(turnsToMessages(null)).toEqual([])
    })

    it('maps displayText from turn to user message for menu selection', () => {
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

    it('ignores displayText for free-typed userInput (use userInput in the bubble)', () => {
        const turns = [
            {
                id: 'd2',
                userInput: 'I need help with the AC',
                displayText: 'Drinks', // stale leftover from a prior menu click
                agentResponse: 'Sure, tell me more.',
                routeCategory: 'FACILITIES_MAINTENANCE',
                createdAt: '2025-01-01T12:00:00Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        const userMsg = msgs.find((m) => m.role === 'user')
        expect(userMsg.text).toBe('I need help with the AC')
        expect(userMsg.displayText).toBeNull()
    })

    it('keeps displayText for IT/F&M menu selection prefixes', () => {
        const turns = [
            {
                id: 'd3',
                userInput: '[it_support-menu] Selected Subcategory (name: VPN) (id: sub-a).',
                displayText: 'VPN',
                agentResponse: 'Got it.',
                routeCategory: 'IT_SUPPORT',
                createdAt: '2025-01-01T12:00:00Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        const userMsg = msgs.find((m) => m.role === 'user')
        expect(userMsg.displayText).toBe('VPN')
    })

    it('maps SYSTEM turn to a single agent message without a user bubble', () => {
        const agentResponse = JSON.stringify({
            replyType: 'text',
            textString: 'Your Catering request CAT-2026-00042 is now Confirmed.',
            payload: { subtype: 'none' },
        })
        const turns = [
            {
                id: 'sys1',
                turnKind: 'SYSTEM',
                userInput: null,
                displayText: null,
                agentResponse,
                routeCategory: 'CATERING',
                createdAt: '2025-01-01T12:00:00Z',
                updatedAt: '2025-01-01T12:00:01Z',
            },
        ]
        const msgs = turnsToMessages(turns)
        expect(msgs).toHaveLength(1)
        expect(msgs[0].role).toBe('ai')
        expect(msgs[0].system).toBe(true)
        expect(msgs[0].text).toBe('Your Catering request CAT-2026-00042 is now Confirmed.')
        expect(msgs[0].payload).toBeNull()
        expect(msgs[0].handledBy).toBe('CATERING')
    })
})
