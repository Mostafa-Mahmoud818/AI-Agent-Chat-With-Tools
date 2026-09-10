import { describe, it, expect } from 'vitest'
import {
    formatMenuSelectionMessage,
    isMenuSelectionUserInput,
    isAttachmentMarkerUserInput,
    resolveMenuPrefixFromHandledBy,
    MENU_PREFIX,
} from '../menuSelection.js'

describe('isMenuSelectionUserInput', () => {
    it('detects catering / IT / F&M / absence menu prefixes', () => {
        expect(isMenuSelectionUserInput('[catering-menu] Selected Category (id: 1)')).toBe(true)
        expect(isMenuSelectionUserInput('[it_support-menu] Selected Subcategory (id: 1)')).toBe(true)
        expect(isMenuSelectionUserInput('[facilities-menu] Selected Item (id: 1)')).toBe(true)
        expect(isMenuSelectionUserInput('[student_absence-menu] Selected Reason (name: Personal) (id: 1)')).toBe(true)
    })

    it('returns false for free-typed text, attachment markers, and nullish input', () => {
        expect(isMenuSelectionUserInput('Hello')).toBe(false)
        expect(isMenuSelectionUserInput('[attachment] path=a filename=b type=c')).toBe(false)
        expect(isAttachmentMarkerUserInput('[attachment] path=a filename=b type=c')).toBe(true)
        expect(isMenuSelectionUserInput(null)).toBe(false)
        expect(isMenuSelectionUserInput(undefined)).toBe(false)
        expect(isMenuSelectionUserInput('')).toBe(false)
    })
})

describe('formatMenuSelectionMessage', () => {
    it('formats category selection with [catering-menu] prefix + displayText', () => {
        const result = formatMenuSelectionMessage({ id: 'cat-1', label: 'Drinks' }, 'CATERING')
        expect(result.agentInput).toBe('[catering-menu] Selected Category (name: Drinks) (id: cat-1)')
        expect(result.displayText).toBe('Drinks')
    })

    it('formats subcategory when categoryId is set', () => {
        const result = formatMenuSelectionMessage({
            id: 'sub-1',
            label: 'Cold',
            categoryId: 'cat-1',
        }, 'CATERING')
        expect(result.agentInput).toBe('[catering-menu] Selected Subcategory (name: Cold) (id: sub-1)')
        expect(result.displayText).toBe('Cold')
    })

    it('formats product when code is set (code detects depth only — not in signal)', () => {
        const result = formatMenuSelectionMessage({
            id: 'p-1',
            label: 'Water',
            code: '999',
            price: 0,
        }, 'CATERING')
        expect(result.agentInput).toBe('[catering-menu] Selected Product (name: Water) (id: p-1)')
        expect(result.displayText).toBe('Water')
    })

    it('omits name clause when item has no label or name but keeps id', () => {
        const result = formatMenuSelectionMessage({ id: 'cat-1', categoryId: null, code: null }, 'CATERING')
        expect(result.agentInput).toBe('[catering-menu] Selected Category (id: cat-1)')
        expect(result.displayText).toBeNull()
    })

    it('returns agentInput equal to input and null displayText for primitive input', () => {
        const result = formatMenuSelectionMessage('hello')
        expect(result).toEqual({ agentInput: 'hello', displayText: null })
    })

    it('uses [it_support-menu] for IT area row (no categoryId)', () => {
        const result = formatMenuSelectionMessage({ id: 'sub-a', label: 'VPN' }, 'IT_SUPPORT')
        expect(result.agentInput).toBe('[it_support-menu] Selected Subcategory (name: VPN) (id: sub-a)')
        expect(result.displayText).toBe('VPN')
    })

    it('uses [it_support-menu] for IT leaf row (categoryId = parent subcategory)', () => {
        const result = formatMenuSelectionMessage(
            { id: 'item-9', label: 'VPN dropouts', categoryId: 'sub-a' },
            'IT_SUPPORT',
        )
        expect(result.agentInput).toBe(
            '[it_support-menu] Selected Item (name: VPN dropouts) (id: item-9)',
        )
    })

    it('uses [facilities-menu] for F&M when handledBy is FACILITIES_MAINTENANCE', () => {
        const result = formatMenuSelectionMessage({ id: 'x', label: 'Cleaning' }, 'FACILITIES_MAINTENANCE')
        expect(result.agentInput).toContain('[facilities-menu]')
        expect(result.agentInput).toContain('Selected Subcategory')
    })

    it('uses [student_absence-menu] Selected Reason for absence', () => {
        const result = formatMenuSelectionMessage(
            { id: 'r-1', label: 'Personal' },
            'Absence Request Agent',
        )
        expect(result.agentInput).toBe(
            '[student_absence-menu] Selected Reason (name: Personal) (id: r-1)',
        )
    })

    it('does not default unknown handledBy to catering', () => {
        expect(resolveMenuPrefixFromHandledBy('Front Door Agent')).toBeNull()
        expect(resolveMenuPrefixFromHandledBy(null)).toBeNull()
        const result = formatMenuSelectionMessage({ id: 'x', label: 'Y' }, 'Front Door Agent')
        expect(result.agentInput).not.toContain('[catering-menu]')
    })

    it('resolveMenuPrefixFromHandledBy maps SSE and enum labels', () => {
        expect(resolveMenuPrefixFromHandledBy('IT_SUPPORT')).toBe(MENU_PREFIX.it_support)
        expect(resolveMenuPrefixFromHandledBy('IT Support Agent')).toBe(MENU_PREFIX.it_support)
        expect(resolveMenuPrefixFromHandledBy('it_support')).toBe(MENU_PREFIX.it_support)
        expect(resolveMenuPrefixFromHandledBy('FACILITIES_MAINTENANCE')).toBe(MENU_PREFIX.facilities_maintenance)
        expect(resolveMenuPrefixFromHandledBy('facilities_maintenance')).toBe(MENU_PREFIX.facilities_maintenance)
        expect(resolveMenuPrefixFromHandledBy('CATERING')).toBe(MENU_PREFIX.catering)
        expect(resolveMenuPrefixFromHandledBy('catering')).toBe(MENU_PREFIX.catering)
        expect(resolveMenuPrefixFromHandledBy('STUDENT_ABSENCE')).toBe(MENU_PREFIX.student_absence)
        expect(resolveMenuPrefixFromHandledBy('Absence Request Agent')).toBe(MENU_PREFIX.student_absence)
        expect(resolveMenuPrefixFromHandledBy('banner_error')).toBe(MENU_PREFIX.banner_error)
        expect(resolveMenuPrefixFromHandledBy('BANNER_ERROR')).toBe(MENU_PREFIX.banner_error)
        expect(resolveMenuPrefixFromHandledBy('Error Banner Agent')).toBe(MENU_PREFIX.banner_error)
        expect(resolveMenuPrefixFromHandledBy('ERROR')).toBeNull()
        expect(resolveMenuPrefixFromHandledBy('error')).toBeNull()
    })

    it('banner_error fallback emits Selected Category (not Reason)', () => {
        const result = formatMenuSelectionMessage(
            { id: 'cat-banner-1', label: 'Login issue', code: null, categoryId: null },
            'banner_error',
        )
        expect(result.agentInput).toBe(
            '[banner_error-menu] Selected Category (name: Login issue) (id: cat-banner-1)',
        )
        expect(result.displayText).toBe('Login issue')
    })
})
