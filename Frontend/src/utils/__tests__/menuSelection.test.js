import { describe, it, expect } from 'vitest'
import { formatMenuSelectionMessage, resolveMenuPrefixFromHandledBy, MENU_PREFIX } from '../menuSelection.js'

describe('formatMenuSelectionMessage', () => {
    it('formats category selection with [catering-menu] prefix + displayText', () => {
        const result = formatMenuSelectionMessage({ id: 'cat-1', label: 'Drinks' })
        expect(result.agentInput).toBe('[catering-menu] Selected category "Drinks" (id: cat-1).')
        expect(result.displayText).toBe('Drinks')
    })

    it('formats subcategory when categoryId is set', () => {
        const result = formatMenuSelectionMessage({
            id: 'sub-1',
            label: 'Cold',
            categoryId: 'cat-1',
        })
        expect(result.agentInput).toBe('[catering-menu] Selected subcategory "Cold" (id: sub-1).')
        expect(result.displayText).toBe('Cold')
    })

    it('formats product when code is set', () => {
        const result = formatMenuSelectionMessage({
            id: 'p-1',
            label: 'Water',
            code: '999',
            price: 0,
        })
        expect(result.agentInput).toBe('[catering-menu] Selected product "Water" (id: p-1) (code: 999).')
        expect(result.displayText).toBe('Water')
    })

    it('omits label in agentInput when item has no label or name but keeps id', () => {
        const result = formatMenuSelectionMessage({ id: 'cat-1', categoryId: null, code: null })
        expect(result.agentInput).toBe('[catering-menu] Selected category (id: cat-1).')
        expect(result.displayText).toBeNull()
    })

    it('returns agentInput equal to input and null displayText for primitive input', () => {
        const result = formatMenuSelectionMessage('hello')
        expect(result).toEqual({ agentInput: 'hello', displayText: null })
    })

    it('uses [it-support-menu] for IT area row (no categoryId)', () => {
        const result = formatMenuSelectionMessage({ id: 'sub-a', label: 'VPN' }, 'IT_SUPPORT')
        expect(result.agentInput).toBe('[it-support-menu] Selected category "VPN" (id: sub-a).')
        expect(result.displayText).toBe('VPN')
    })

    it('uses [it-support-menu] for IT leaf row (categoryId = parent subcategory)', () => {
        const result = formatMenuSelectionMessage(
            { id: 'item-9', label: 'VPN dropouts', categoryId: 'sub-a' },
            'IT_SUPPORT',
        )
        expect(result.agentInput).toBe(
            '[it-support-menu] Selected service item "VPN dropouts" (id: item-9) (subcategoryId: sub-a).',
        )
    })

    it('uses [facilities-menu] for F&M when handledBy is FACILITIES_MAINTENANCE', () => {
        const result = formatMenuSelectionMessage({ id: 'x', label: 'Cleaning' }, 'FACILITIES_MAINTENANCE')
        expect(result.agentInput).toContain('[facilities-menu]')
        expect(result.agentInput).toContain('Selected category')
    })

    it('resolveMenuPrefixFromHandledBy maps SSE and enum labels', () => {
        expect(resolveMenuPrefixFromHandledBy('IT_SUPPORT')).toBe(MENU_PREFIX.it_support)
        expect(resolveMenuPrefixFromHandledBy('IT Support Agent')).toBe(MENU_PREFIX.it_support)
        expect(resolveMenuPrefixFromHandledBy('FACILITIES_MAINTENANCE')).toBe(MENU_PREFIX.facilities_maintenance)
        expect(resolveMenuPrefixFromHandledBy('CATERING')).toBe(MENU_PREFIX.catering)
    })
})
