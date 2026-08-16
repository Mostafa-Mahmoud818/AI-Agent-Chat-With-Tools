import { describe, it, expect } from 'vitest'
import {
    parseSelectionSignal,
    rootCrumbFor,
    updateChainOnSelection,
    reconcileChainWithResponse,
    deriveBreadcrumb,
    rebuildChainFromMessages,
} from '../breadcrumb.js'

describe('parseSelectionSignal', () => {
    it('parses a catering category signal', () => {
        expect(parseSelectionSignal('[catering-menu] Selected Category (name: Drinks) (id: cat-42)'))
            .toEqual({ prefix: 'catering-menu', level: 'Category', name: 'Drinks', id: 'cat-42' })
    })

    it('parses a catering subcategory signal with parentheses inside name', () => {
        expect(parseSelectionSignal('[catering-menu] Selected Subcategory (name: Mac (Vegan)) (id: sub-7)'))
            .toEqual({ prefix: 'catering-menu', level: 'Subcategory', name: 'Mac (Vegan)', id: 'sub-7' })
    })

    it('parses a catering product signal with UUID id', () => {
        expect(parseSelectionSignal('[catering-menu] Selected Product (name: Cappuccino) (id: 9a2a39ec-9cd3-4f89-b703-af433d910215)'))
            .toEqual({ prefix: 'catering-menu', level: 'Product', name: 'Cappuccino', id: '9a2a39ec-9cd3-4f89-b703-af433d910215' })
    })

    it('parses legacy signals with trailing period and optional (code: …)', () => {
        expect(parseSelectionSignal('[catering-menu] Selected Product (name: Water) (id: p-1) (code: 999).'))
            .toEqual({ prefix: 'catering-menu', level: 'Product', name: 'Water', id: 'p-1' })
        expect(parseSelectionSignal('[it_support-menu] Selected Item (name: VPN) (id: item-9).'))
            .toEqual({ prefix: 'it_support-menu', level: 'Item', name: 'VPN', id: 'item-9' })
    })

    it('parses IT support and facilities signals', () => {
        expect(parseSelectionSignal('[it_support-menu] Selected Subcategory (name: Network) (id: area-7)'))
            .toEqual({ prefix: 'it_support-menu', level: 'Subcategory', name: 'Network', id: 'area-7' })
        expect(parseSelectionSignal('[facilities-menu] Selected Item (name: AC repair) (id: f-2)'))
            .toEqual({ prefix: 'facilities-menu', level: 'Item', name: 'AC repair', id: 'f-2' })
    })

    it('returns null for non-signal strings', () => {
        expect(parseSelectionSignal('Hello, I need catering')).toBeNull()
        expect(parseSelectionSignal('')).toBeNull()
        expect(parseSelectionSignal(null)).toBeNull()
        expect(parseSelectionSignal(undefined)).toBeNull()
        expect(parseSelectionSignal({})).toBeNull()
    })
})

describe('rootCrumbFor', () => {
    it('maps SSE display labels to root crumb', () => {
        expect(rootCrumbFor('Visitor Experience Agent')).toEqual({ label: 'Assistant', levelKey: 'root' })
        expect(rootCrumbFor('Catering Agent')).toEqual({ label: 'Menu', levelKey: 'root' })
        expect(rootCrumbFor('IT Support Agent')).toEqual({ label: 'IT Support', levelKey: 'root' })
        expect(rootCrumbFor('Facilities & Maintenance Agent')).toEqual({ label: 'Facilities & Maintenance', levelKey: 'root' })
        expect(rootCrumbFor('Facilities Maintenance Agent')).toEqual({ label: 'Facilities & Maintenance', levelKey: 'root' })
    })

    it('maps persisted routeCategory enum strings to root crumb', () => {
        expect(rootCrumbFor('VISITOR_EXPERIENCE')).toEqual({ label: 'Assistant', levelKey: 'root' })
        expect(rootCrumbFor('CATERING')).toEqual({ label: 'Menu', levelKey: 'root' })
        expect(rootCrumbFor('IT_SUPPORT')).toEqual({ label: 'IT Support', levelKey: 'root' })
        expect(rootCrumbFor('FACILITIES_MAINTENANCE')).toEqual({ label: 'Facilities & Maintenance', levelKey: 'root' })
        expect(rootCrumbFor('ERROR')).toEqual({ label: 'Assistant', levelKey: 'root' })
        expect(rootCrumbFor('error')).toEqual({ label: 'Assistant', levelKey: 'root' })
    })

    it('defaults to Assistant for unknown handlers', () => {
        expect(rootCrumbFor(null)).toEqual({ label: 'Assistant', levelKey: 'root' })
        expect(rootCrumbFor('Unknown')).toEqual({ label: 'Assistant', levelKey: 'root' })
    })

    it('matches handledBy case-insensitively (resilient to backend casing drift)', () => {
        expect(rootCrumbFor('catering agent')).toEqual({ label: 'Menu', levelKey: 'root' })
        expect(rootCrumbFor('IT support Agent')).toEqual({ label: 'IT Support', levelKey: 'root' })
        expect(rootCrumbFor('  visitor experience agent  ')).toEqual({ label: 'Assistant', levelKey: 'root' })
        expect(rootCrumbFor('it_support')).toEqual({ label: 'IT Support', levelKey: 'root' })
    })
})

describe('updateChainOnSelection', () => {
    it('replaces chain with single entry on Category', () => {
        const chain = [{ level: 'Subcategory', name: 'Old', id: 'old' }]
        const parsed = { prefix: 'catering-menu', level: 'Category', name: 'Drinks', id: 'cat-1' }
        expect(updateChainOnSelection(chain, parsed))
            .toEqual([{ level: 'Category', name: 'Drinks', id: 'cat-1' }])
    })

    it('appends Subcategory under existing Category', () => {
        const chain = [{ level: 'Category', name: 'Drinks', id: 'cat-1' }]
        const parsed = { prefix: 'catering-menu', level: 'Subcategory', name: 'Hot Drinks', id: 'sub-7' }
        expect(updateChainOnSelection(chain, parsed)).toEqual([
            { level: 'Category', name: 'Drinks', id: 'cat-1' },
            { level: 'Subcategory', name: 'Hot Drinks', id: 'sub-7' },
        ])
    })

    it('Subcategory without parent Category becomes a single-entry chain (IT/FM root)', () => {
        const parsed = { prefix: 'it_support-menu', level: 'Subcategory', name: 'Network', id: 'area-7' }
        expect(updateChainOnSelection([], parsed))
            .toEqual([{ level: 'Subcategory', name: 'Network', id: 'area-7' }])
    })

    it('Product / Item do not extend the chain', () => {
        const chain = [{ level: 'Category', name: 'C', id: '1' }, { level: 'Subcategory', name: 'S', id: '2' }]
        const product = { prefix: 'catering-menu', level: 'Product', name: 'P', id: 'p-1' }
        expect(updateChainOnSelection(chain, product)).toBe(chain)
        const item = { prefix: 'it_support-menu', level: 'Item', name: 'I', id: 'i-1' }
        expect(updateChainOnSelection([{ level: 'Subcategory', name: 'S', id: '2' }], item))
            .toEqual([{ level: 'Subcategory', name: 'S', id: '2' }])
    })

    it('null parsed signal leaves chain unchanged', () => {
        const chain = [{ level: 'Category', name: 'C', id: '1' }]
        expect(updateChainOnSelection(chain, null)).toBe(chain)
    })
})

describe('reconcileChainWithResponse', () => {
    it('catering: categories displayed → chain cleared', () => {
        const chain = [{ level: 'Category', name: 'Old', id: 'cat-X' }]
        const items = [{ id: 'cat-1', label: 'Drinks' }] // no code, no categoryId → category
        expect(reconcileChainWithResponse(chain, items, 'Catering Agent')).toEqual([])
    })

    it('catering: subcategories displayed → chain trimmed to first Category', () => {
        const chain = [
            { level: 'Category', name: 'Drinks', id: 'cat-1' },
            { level: 'Subcategory', name: 'StaleSub', id: 'sub-stale' },
        ]
        const items = [{ id: 'sub-7', label: 'Hot Drinks', categoryId: 'cat-1' }]
        expect(reconcileChainWithResponse(chain, items, 'Catering Agent'))
            .toEqual([{ level: 'Category', name: 'Drinks', id: 'cat-1' }])
    })

    it('catering: products displayed → chain kept up to 2 ancestors', () => {
        const chain = [
            { level: 'Category', name: 'Drinks', id: 'cat-1' },
            { level: 'Subcategory', name: 'Hot Drinks', id: 'sub-7' },
        ]
        const items = [{ id: 'p-1', label: 'Cappuccino', code: 'CAP01', categoryId: 'sub-7' }]
        expect(reconcileChainWithResponse(chain, items, 'Catering Agent')).toEqual(chain)
    })

    it('IT/FM: areas displayed → chain cleared', () => {
        const chain = [{ level: 'Subcategory', name: 'Old', id: 'area-X' }]
        const items = [{ id: 'area-1', label: 'Network' }] // no categoryId → subcategory root for IT/FM
        expect(reconcileChainWithResponse(chain, items, 'IT Support Agent')).toEqual([])
    })

    it('IT/FM: items displayed → chain trimmed to first Subcategory', () => {
        const chain = [{ level: 'Subcategory', name: 'Network', id: 'area-7' }]
        const items = [{ id: 'i-1', label: 'Reset VPN', categoryId: 'area-7' }]
        expect(reconcileChainWithResponse(chain, items, 'IT Support Agent')).toEqual(chain)
    })

    it('empty items array leaves chain unchanged', () => {
        const chain = [{ level: 'Category', name: 'C', id: '1' }]
        expect(reconcileChainWithResponse(chain, [], 'Catering Agent')).toBe(chain)
    })
})

describe('deriveBreadcrumb', () => {
    it('returns just the root crumb for empty chain', () => {
        expect(deriveBreadcrumb('Catering Agent', []))
            .toEqual([{ label: 'Menu', levelKey: 'root' }])
    })

    it('builds catering 3-level breadcrumb', () => {
        const chain = [
            { level: 'Category', name: 'Drinks', id: 'cat-1' },
            { level: 'Subcategory', name: 'Hot Drinks', id: 'sub-7' },
        ]
        expect(deriveBreadcrumb('Catering Agent', chain)).toEqual([
            { label: 'Menu', levelKey: 'root' },
            { label: 'Drinks', levelKey: 'cat/cat-1' },
            { label: 'Hot Drinks', levelKey: 'sub/sub-7' },
        ])
    })

    it('builds IT support 2-level breadcrumb', () => {
        const chain = [{ level: 'Subcategory', name: 'Network', id: 'area-7' }]
        expect(deriveBreadcrumb('IT_SUPPORT', chain)).toEqual([
            { label: 'IT Support', levelKey: 'root' },
            { label: 'Network', levelKey: 'sub/area-7' },
        ])
    })

    it('drops chain entries missing name or id', () => {
        const chain = [
            { level: 'Category', name: '', id: 'cat-1' },
            { level: 'Subcategory', name: 'OK', id: 'sub-7' },
        ]
        expect(deriveBreadcrumb('Catering Agent', chain)).toEqual([
            { label: 'Menu', levelKey: 'root' },
            { label: 'OK', levelKey: 'sub/sub-7' },
        ])
    })
})

describe('rebuildChainFromMessages', () => {
    it('reconstructs the chain from persisted user signal messages', () => {
        const messages = [
            { role: 'user', text: 'Hello, I need catering' },
            { role: 'ai', text: 'Here are our available categories.' },
            { role: 'user', text: '[catering-menu] Selected Category (name: Drinks) (id: cat-1)' },
            { role: 'ai', text: 'Here are the subcategories in Drinks.' },
            { role: 'user', text: '[catering-menu] Selected Subcategory (name: Hot Drinks) (id: sub-7)' },
            { role: 'ai', text: 'Here are the products in Hot Drinks.' },
        ]
        expect(rebuildChainFromMessages(messages)).toEqual([
            { level: 'Category', name: 'Drinks', id: 'cat-1' },
            { level: 'Subcategory', name: 'Hot Drinks', id: 'sub-7' },
        ])
    })

    it('ignores non-signal user messages', () => {
        const messages = [
            { role: 'user', text: 'show me drinks' },
            { role: 'user', text: 'what about hot drinks?' },
        ]
        expect(rebuildChainFromMessages(messages)).toEqual([])
    })

    it('handles empty or null input', () => {
        expect(rebuildChainFromMessages(null)).toEqual([])
        expect(rebuildChainFromMessages([])).toEqual([])
    })
})
