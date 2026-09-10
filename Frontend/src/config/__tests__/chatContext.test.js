import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    buildVisitChatContext,
    DEFAULT_VISIT_ID,
    getRuntimeVisitId,
    getVisitIdRequiredMessage,
    getVisitIdComposerPlaceholder,
    hasConfiguredVisitId,
    isOtherVisitConversation,
    isPlaceholderVisitId,
    isValidVisitId,
    normalizeVisitId,
    resolveVisitId,
    setRuntimeVisitId,
    STORAGE_KEY,
} from '../chatContext.js'

describe('chatContext', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('location', { ...window.location, search: '' })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('validates UUID shape', () => {
        expect(isValidVisitId('00000000-0000-0000-0000-000000000000')).toBe(true)
        expect(isValidVisitId('not-a-uuid')).toBe(false)
        expect(normalizeVisitId(' 00000000-0000-0000-0000-000000000000 ')).toBe(
            '00000000-0000-0000-0000-000000000000',
        )
    })

    it('buildVisitChatContext uses VISIT envelope with generic id', () => {
        setRuntimeVisitId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        const ctx = buildVisitChatContext()
        expect(ctx).toEqual({
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
        })
        expect(ctx.contextData).not.toHaveProperty('visitId')
        expect(Object.keys(ctx.contextData)).toEqual(['id'])
    })

    it('resolveVisitId prefers query param over storage', () => {
        setRuntimeVisitId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        vi.stubGlobal('location', {
            ...window.location,
            search: '?visitId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        })
        expect(resolveVisitId()).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    })

    it('falls back to default nil UUID when no query, storage, or env', () => {
        const env = { VITE_DEFAULT_VISIT_ID: undefined }
        expect(resolveVisitId(env)).toBe(DEFAULT_VISIT_ID)
    })

    it('isPlaceholderVisitId treats nil UUID as unconfigured', () => {
        expect(isPlaceholderVisitId(DEFAULT_VISIT_ID)).toBe(true)
        expect(isPlaceholderVisitId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')).toBe(false)
        expect(isPlaceholderVisitId(null)).toBe(true)
    })

    it('hasConfiguredVisitId is false without storage or env', () => {
        const env = { VITE_DEFAULT_VISIT_ID: undefined }
        expect(hasConfiguredVisitId(env)).toBe(false)
    })

    it('hasConfiguredVisitId is true when visit id is stored', () => {
        setRuntimeVisitId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        expect(hasConfiguredVisitId()).toBe(true)
    })

    it('persists runtime visit id in localStorage', () => {
        setRuntimeVisitId('cccccccc-cccc-cccc-cccc-cccccccccccc')
        expect(getRuntimeVisitId()).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc')
        expect(localStorage.getItem(STORAGE_KEY)).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc')
    })

    it('getVisitIdRequiredMessage is the sign-in copy', () => {
        expect(getVisitIdRequiredMessage()).toMatch(/Sign in/)
    })

    it('getVisitIdComposerPlaceholder is the sign-in copy', () => {
        expect(getVisitIdComposerPlaceholder()).toMatch(/Sign in/)
    })

    describe('isOtherVisitConversation', () => {
        const CURRENT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

        beforeEach(() => setRuntimeVisitId(CURRENT))

        it('is true for a VISIT conversation from a different visit', () => {
            expect(isOtherVisitConversation({ contextType: 'VISIT', contextTypeId: OTHER })).toBe(true)
        })

        it('is false for a VISIT conversation matching the current visit', () => {
            expect(isOtherVisitConversation({ contextType: 'VISIT', contextTypeId: CURRENT })).toBe(false)
        })

        it('is false for null / new / non-VISIT / id-less conversations', () => {
            expect(isOtherVisitConversation(null)).toBe(false)
            expect(isOtherVisitConversation({})).toBe(false)
            expect(isOtherVisitConversation({ contextType: 'STUDENT', contextTypeId: OTHER })).toBe(false)
            expect(isOtherVisitConversation({ contextType: 'VISIT', contextTypeId: null })).toBe(false)
        })

        it('is false when no current visit is configured (cannot gate)', () => {
            setRuntimeVisitId('')
            const env = { VITE_DEFAULT_VISIT_ID: undefined }
            expect(isOtherVisitConversation({ contextType: 'VISIT', contextTypeId: OTHER }, env)).toBe(false)
        })
    })
})
