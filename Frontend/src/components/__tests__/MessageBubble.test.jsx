import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MessageBubble from '../chat/MessageBubble'

function makeItems(count, { product = false } = {}) {
    return Array.from({ length: count }, (_, i) => ({
        id: `i${i + 1}`,
        label: `Item ${i + 1}`,
        description: product ? null : `Desc ${i + 1}`,
        price: product ? i : null,
        code: product ? String(100 + i) : null,
        categoryId: null,
        status: product ? 'AVAILABLE' : null,
    }))
}

describe('MessageBubble', () => {
    it('renders user message as plain text', () => {
        const msg = { id: 'u1', role: 'user', text: 'Hello world', timestamp: new Date() }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Hello world')).toBeInTheDocument()
        expect(screen.getByRole('listitem')).toHaveAttribute('aria-label', 'Your message')
    })

    it('renders AI message with markdown', () => {
        const msg = { id: 'a1', role: 'ai', text: '**Bold text**', timestamp: new Date(), handledBy: 'Catering Agent' }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Bold text')).toBeInTheDocument()
        expect(screen.getByText('Answered by Catering')).toBeInTheDocument()
    })

    it('renders persisted FACILITIES_MAINTENANCE route as Facilities & Maintenance subtitle', () => {
        const msg = {
            id: 'a-fm',
            role: 'ai',
            text: 'We can help with that.',
            timestamp: new Date(),
            handledBy: 'FACILITIES_MAINTENANCE',
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Answered by Facilities & Maintenance')).toBeInTheDocument()
    })

    it('renders VISITOR_EXPERIENCE route as Assistant subtitle', () => {
        const msg = {
            id: 'a-vex',
            role: 'ai',
            text: 'Hi! I can help you reach our specialists.',
            timestamp: new Date(),
            handledBy: 'VISITOR_EXPERIENCE',
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Answered by Assistant')).toBeInTheDocument()
    })

    it('renders Visitor Experience Agent SSE label as Assistant', () => {
        const msg = {
            id: 'a-vex-sse',
            role: 'ai',
            text: 'Hello!',
            timestamp: new Date(),
            handledBy: 'Visitor Experience Agent',
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Answered by Assistant')).toBeInTheDocument()
    })

    it('renders Facilities Maintenance Agent catalog label as Facilities & Maintenance', () => {
        const msg = {
            id: 'a-fm-catalog',
            role: 'ai',
            text: 'We can help with that.',
            timestamp: new Date(),
            handledBy: 'Facilities Maintenance Agent',
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Answered by Facilities & Maintenance')).toBeInTheDocument()
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

    it('paginates menu items at page size 6 and advances on Next', () => {
        const msg = {
            id: 'm1',
            role: 'ai',
            text: 'Here are the categories.',
            timestamp: new Date(),
            payload: { subtype: 'menu', menuitems: makeItems(14) },
        }
        render(<MessageBubble message={msg} />)
        // Page 1: items 1–6 visible, 7 not
        expect(screen.getByText('Item 1')).toBeInTheDocument()
        expect(screen.getByText('Item 6')).toBeInTheDocument()
        expect(screen.queryByText('Item 7')).not.toBeInTheDocument()
        expect(screen.getByText('Page 1 of 3')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
        expect(screen.getByText('Item 7')).toBeInTheDocument()
        expect(screen.queryByText('Item 1')).not.toBeInTheDocument()
        expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()

        fireEvent.click(screen.getByRole('button', { name: 'Next page' }))
        expect(screen.getByText('Page 3 of 3')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: 'Next page' })).toBeDisabled()
    })

    it('hides pagination footer when item count <= page size', () => {
        const msg = {
            id: 'm2',
            role: 'ai',
            text: 'Short list',
            timestamp: new Date(),
            payload: { subtype: 'menu', menuitems: makeItems(6) },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.queryByRole('navigation', { name: 'Menu pagination' })).not.toBeInTheDocument()
    })

    it('renders product cards with code badge and no description', () => {
        const msg = {
            id: 'm3',
            role: 'ai',
            text: 'Products',
            timestamp: new Date(),
            payload: { subtype: 'menu', menuitems: makeItems(2, { product: true }) },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('#100')).toBeInTheDocument()
        expect(screen.getByText('#101')).toBeInTheDocument()
        // BRD NFR-05: zero price as $0.0
        expect(screen.getByText('$0.0')).toBeInTheDocument()
        // Description is not rendered for products
        expect(screen.queryByText(/^Desc /)).not.toBeInTheDocument()
    })

    it('passes full menu item to onMenuItemClick when a card is pressed', () => {
        const onMenuItemClick = vi.fn()
        const item = { id: 'uuid-cat-1', label: 'Drinks', description: 'Cold and hot' }
        const msg = {
            id: 'm-cat',
            role: 'ai',
            text: 'Categories',
            timestamp: new Date(),
            payload: { subtype: 'menu', menuitems: [item] },
        }
        render(<MessageBubble message={msg} onMenuItemClick={onMenuItemClick} />)
        fireEvent.click(screen.getByRole('button', { name: /Drinks/i }))
        expect(onMenuItemClick).toHaveBeenCalledTimes(1)
        expect(onMenuItemClick).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'uuid-cat-1', label: 'Drinks' }),
            undefined,
        )
    })

    it('passes handledBy as second arg to onMenuItemClick for route-aware menu prefix', () => {
        const onMenuItemClick = vi.fn()
        const item = { id: 'area-1', label: 'Network', description: '' }
        const msg = {
            id: 'm-it',
            role: 'ai',
            text: 'Areas',
            timestamp: new Date(),
            handledBy: 'IT_SUPPORT',
            payload: { subtype: 'menu', menuitems: [item] },
        }
        render(<MessageBubble message={msg} onMenuItemClick={onMenuItemClick} />)
        fireEvent.click(screen.getByRole('button', { name: /Network/i }))
        expect(onMenuItemClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'area-1' }), 'IT_SUPPORT')
    })

    it('renders empty-menu copy when subtype is menu but list is empty', () => {
        const msg = {
            id: 'm4',
            role: 'ai',
            text: 'Here are the categories.',
            timestamp: new Date(),
            payload: { subtype: 'menu', menuitems: [] },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('No items are currently available. Please try again later or contact support.')).toBeInTheDocument()
    })

    it('renders OUTDOOR navigation card with an Open in Maps link from coordinates', () => {
        const msg = {
            id: 'loc-out',
            role: 'ai',
            text: 'Your destination is at Head Quarter.',
            timestamp: new Date(),
            handledBy: 'VISITOR_EXPERIENCE',
            payload: {
                subtype: 'outdoor_navigation',
                navigation: {
                    locationName: 'Head Quarter',
                    resourceId: 'HQ-001',
                    resourceName: 'Head Quarter',
                    latitude: 24.4473667,
                    longitude: 54.3949106,
                },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Your destination is at Head Quarter.')).toBeInTheDocument()
        expect(screen.getByText('Outdoor Navigation')).toBeInTheDocument()
        const link = screen.getByText('Open in Maps')
        expect(link).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=24.4473667,54.3949106')
        expect(link).toHaveAttribute('target', '_blank')
        expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    })

    it('renders INDOOR navigation card with room/building and no maps link', () => {
        const msg = {
            id: 'loc-in',
            role: 'ai',
            text: 'Your meeting is in Meeting Room A3, located at Building 1.',
            timestamp: new Date(),
            handledBy: 'VISITOR_EXPERIENCE',
            payload: {
                subtype: 'indoor_navigation',
                navigation: {
                    locationName: 'Building 1',
                    resourceId: 'ROOM-123',
                    resourceName: 'Meeting Room A3',
                    latitude: null,
                    longitude: null,
                },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Indoor Navigation')).toBeInTheDocument()
        expect(screen.getByText('Meeting Room A3')).toBeInTheDocument()
        expect(screen.getByText('Building 1')).toBeInTheDocument()
        expect(screen.queryByText('Open in Maps')).not.toBeInTheDocument()
        // Security: internal resourceId stays in the payload but is never rendered
        expect(screen.queryByText(/Resource ID/i)).not.toBeInTheDocument()
        expect(screen.queryByText(/ROOM-123/)).not.toBeInTheDocument()
    })

    const ticketMessage = (id, ticket, extra = {}) => ({
        id,
        role: 'ai',
        text: 'Your IT ticket IT-2026-00042 has been created.',
        timestamp: new Date(),
        handledBy: 'IT_SUPPORT',
        payload: { subtype: 'ticket', menuitems: [], order: null, ticket, ...extra },
    })

    it('ticket card never renders the internal ticket id UUID', () => {
        const msg = ticketMessage('t-sec', {
            id: '9f4c2d8e-1234-4abc-9def-1234567890ab',
            referenceCode: null,
            status: 'PENDING',
            createdAt: null,
        })
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Support Ticket Created')).toBeInTheDocument()
        expect(screen.getByText('PENDING')).toBeInTheDocument()
        expect(screen.queryByText(/9f4c2d8e/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Ticket ID/i)).not.toBeInTheDocument()
    })

    it('ticket card renders referenceCode, status and createdAt from payload.ticket', () => {
        const msg = ticketMessage('t-ref', {
            id: '9f4c2d8e-1234-4abc-9def-1234567890ab',
            referenceCode: 'IT-2026-00042',
            status: 'PENDING',
            createdAt: '2026-07-14T06:00:00Z',
        })
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Reference')).toBeInTheDocument()
        expect(screen.getByText('IT-2026-00042')).toBeInTheDocument()
        expect(screen.getByText('PENDING')).toBeInTheDocument()
        expect(screen.getByText('Created')).toBeInTheDocument()
        expect(screen.getByText(new Date('2026-07-14T06:00:00Z').toLocaleString())).toBeInTheDocument()
        expect(screen.queryByText(/9f4c2d8e/)).not.toBeInTheDocument()
    })

    it('ticket card omits the Created row when createdAt is absent or unparseable', () => {
        const { unmount } = render(<MessageBubble message={ticketMessage('t-no-date', {
            id: 'x', referenceCode: 'IT-2026-00042', status: 'PENDING', createdAt: null,
        })} />)
        expect(screen.queryByText('Created')).not.toBeInTheDocument()
        unmount()

        render(<MessageBubble message={ticketMessage('t-bad-date', {
            id: 'x', referenceCode: 'IT-2026-00042', status: 'PENDING', createdAt: 'not-a-date',
        })} />)
        expect(screen.queryByText('Created')).not.toBeInTheDocument()
        expect(screen.queryByText(/Invalid Date/)).not.toBeInTheDocument()
    })

    it('ticket card still renders legacy flat payload keys (pre-2026-07-27 history)', () => {
        const msg = ticketMessage('t-legacy', undefined, {
            ticketId: '9f4c2d8e-1234-4abc-9def-1234567890ab',
            ticketStatus: 'PENDING',
            referenceCode: 'IT-2026-00042',
        })
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('IT-2026-00042')).toBeInTheDocument()
        expect(screen.getByText('PENDING')).toBeInTheDocument()
        expect(screen.queryByText(/9f4c2d8e/)).not.toBeInTheDocument()
    })

    it('ticket card suppresses a UUID-shaped referenceCode', () => {
        const msg = ticketMessage('t-ref-uuid', {
            id: '9f4c2d8e-1234-4abc-9def-1234567890ab',
            referenceCode: '9f4c2d8e-1234-4abc-9def-1234567890ab',
            status: 'PENDING',
            createdAt: null,
        })
        render(<MessageBubble message={msg} />)
        expect(screen.queryByText('Reference')).not.toBeInTheDocument()
        expect(screen.queryByText(/9f4c2d8e/)).not.toBeInTheDocument()
    })

    it('order confirmation prefers referenceCode and suppresses UUID-shaped order ids', () => {
        const msg = {
            id: 'o-sec',
            role: 'ai',
            text: 'Your order has been placed successfully.',
            timestamp: new Date(),
            handledBy: 'CATERING',
            payload: {
                subtype: 'order_confirmation',
                menuitems: [],
                order: {
                    id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d',
                    referenceCode: 'CT-2026-00007',
                    status: 'PENDING',
                    totalPrice: 12.5,
                    createdAt: '2026-06-11T09:00:00Z',
                    items: [],
                },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Reference')).toBeInTheDocument()
        expect(screen.getByText('CT-2026-00007')).toBeInTheDocument()
        expect(screen.queryByText(/0a1b2c3d/)).not.toBeInTheDocument()
        expect(screen.queryByText(/Order ID/i)).not.toBeInTheDocument()
    })

    it('order confirmation without referenceCode hides UUID id entirely', () => {
        const msg = {
            id: 'o-sec-2',
            role: 'ai',
            text: 'Order placed.',
            timestamp: new Date(),
            handledBy: 'CATERING',
            payload: {
                subtype: 'order_confirmation',
                menuitems: [],
                order: { id: '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', status: 'PENDING', items: [] },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('PENDING')).toBeInTheDocument()
        expect(screen.queryByText('Reference')).not.toBeInTheDocument()
        expect(screen.queryByText(/0a1b2c3d/)).not.toBeInTheDocument()
    })

    it('renders error copy when subtype is error and suppresses textString', () => {
        const msg = {
            id: 'm5',
            role: 'ai',
            text: 'this text must not leak',
            timestamp: new Date(),
            payload: { subtype: 'error', menuitems: [], order: null },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Something went wrong while loading the menu. Please try again or contact support if the issue persists.')).toBeInTheDocument()
        expect(screen.queryByText('this text must not leak')).not.toBeInTheDocument()
    })

    it('renders visits_query card with title, host, and suppresses visitId UUID', () => {
        const visitUuid = '9f4c2d8e-1234-4abc-9def-1234567890ab'
        const msg = {
            id: 'vq-1',
            role: 'ai',
            text: 'You have 1 meeting today.',
            timestamp: new Date(),
            handledBy: 'VISITOR_EXPERIENCE',
            payload: {
                subtype: 'visits_query',
                menuitems: [],
                order: null,
                visits: {
                    scope: 'today',
                    timezone: 'Asia/Dubai',
                    totalCount: 1,
                    page: 0,
                    size: 20,
                    items: [{
                        visitId: visitUuid,
                        title: 'Quarterly Review',
                        status: 'UPCOMING',
                        timeDisplay: 'Sat, Jun 28, 10:00 AM – 11:00 AM',
                        hostName: 'Dr. Al Mansoori',
                        resourceName: 'Conference Room',
                        locationName: 'HQ',
                    }],
                },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Meetings & Visits')).toBeInTheDocument()
        expect(screen.getByText('Quarterly Review')).toBeInTheDocument()
        expect(screen.getByText('Host: Dr. Al Mansoori')).toBeInTheDocument()
        expect(screen.getByText('UPCOMING')).toBeInTheDocument()
        expect(screen.queryByText(/9f4c2d8e/)).not.toBeInTheDocument()
    })

    it('renders visits_query empty state when items is empty', () => {
        const msg = {
            id: 'vq-empty',
            role: 'ai',
            text: 'No meetings today.',
            timestamp: new Date(),
            payload: {
                subtype: 'visits_query',
                visits: { scope: 'today', timezone: 'Asia/Dubai', totalCount: 0, items: [] },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('No meetings or visits found for this period.')).toBeInTheDocument()
    })

    it('renders multiple visit items in visits_query card', () => {
        const msg = {
            id: 'vq-multi',
            role: 'ai',
            text: 'You have 2 meetings.',
            timestamp: new Date(),
            payload: {
                subtype: 'visits_query',
                visits: {
                    scope: 'upcoming',
                    totalCount: 2,
                    items: [
                        { title: 'Team Sync', status: 'UPCOMING', timeDisplay: 'Mon 10:00 AM' },
                        { title: 'Board Review', status: 'UPCOMING', timeDisplay: 'Tue 2:00 PM' },
                    ],
                },
            },
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText('Team Sync')).toBeInTheDocument()
        expect(screen.getByText('Board Review')).toBeInTheDocument()
    })

    it('renders text-only previous+upcoming listing without visits_query card', () => {
        const listingText = `**Upcoming visits**

1. Vendor Meeting — Tue 15 Jul

**Previous visits**

2. Board Review — Mon 7 Jul

Which visit would you like to know more about?`
        const msg = {
            id: 've-text-list',
            role: 'ai',
            text: listingText,
            timestamp: new Date(),
            handledBy: 'VISITOR_EXPERIENCE',
            payload: null,
        }
        render(<MessageBubble message={msg} />)
        expect(screen.getByText(/Which visit would you like to know more about\?/)).toBeInTheDocument()
        expect(screen.getByText(/Vendor Meeting/)).toBeInTheDocument()
        expect(screen.queryByText('Meetings & Visits')).not.toBeInTheDocument()
    })
})

describe('MessageBubble user message displayText', () => {
    it('renders displayText instead of text for user messages when displayText is present', () => {
        const message = {
            id: 'u1',
            role: 'user',
            text: '[catering-menu] Selected category "Drinks" (id: 05d5752f).',
            displayText: 'Drinks',
            timestamp: new Date(),
        }
        render(<MessageBubble message={message} />)
        expect(screen.getByText('Drinks')).toBeInTheDocument()
        expect(
            screen.queryByText('[catering-menu] Selected category "Drinks" (id: 05d5752f).')
        ).not.toBeInTheDocument()
    })

    it('falls back to text when displayText is null', () => {
        const message = {
            id: 'u2',
            role: 'user',
            text: 'Show me the menu',
            displayText: null,
            timestamp: new Date(),
        }
        render(<MessageBubble message={message} />)
        expect(screen.getByText('Show me the menu')).toBeInTheDocument()
    })
})
