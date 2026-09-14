import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    buildVisitChatContext,
    buildStudentChatContext,
    DEFAULT_VISIT_ID,
    getRuntimeVisitId,
    getVisitIdRequiredMessage,
    getVisitIdComposerPlaceholder,
    hasConfiguredVisitId,
    hasConfiguredDxpUserId,
    isOtherVisitConversation,
    isPlaceholderVisitId,
    isValidVisitId,
    isVisitorContextType,
    normalizeVisitId,
    resolveVisitId,
    setRuntimeVisitId,
    setRuntimeDxpUserId,
    STORAGE_KEY,
} from '../chatContext.js'

const USER = '11111111-1111-4111-8111-111111111111'
const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

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

    it('isVisitorContextType accepts VISITOR and legacy VISIT', () => {
        expect(isVisitorContextType('VISITOR')).toBe(true)
        expect(isVisitorContextType('VISIT')).toBe(true)
        expect(isVisitorContextType('STUDENT')).toBe(false)
    })

    it('buildVisitChatContext uses VISITOR envelope with userId and visitId', () => {
        setRuntimeVisitId(VISIT)
        setRuntimeDxpUserId(USER)
        const ctx = buildVisitChatContext()
        expect(ctx).toEqual({
            schemaVersion: '1.0',
            contextType: 'VISITOR',
            userId: USER,
            contextData: { visitId: VISIT },
        })
        expect(ctx.contextData).not.toHaveProperty('id')
    })

    it('buildStudentChatContext uses empty contextData and userId', () => {
        setRuntimeDxpUserId(USER)
        expect(buildStudentChatContext()).toEqual({
            schemaVersion: '1.0',
            contextType: 'STUDENT',
            userId: USER,
            contextData: {},
        })
    })

    it('buildVisitChatContext throws without userId', () => {
        setRuntimeVisitId(VISIT)
        expect(() => buildVisitChatContext({ VITE_DEFAULT_USER_ID: undefined })).toThrow(/userId/)
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
        expect(isPlaceholderVisitId(VISIT)).toBe(false)
        expect(isPlaceholderVisitId(null)).toBe(true)
    })

    it('hasConfiguredVisitId is false without storage or env', () => {
        const env = { VITE_DEFAULT_VISIT_ID: undefined }
        expect(hasConfiguredVisitId(env)).toBe(false)
    })

    it('hasConfiguredVisitId is true when visit id is stored', () => {
        setRuntimeVisitId(VISIT)
        expect(hasConfiguredVisitId()).toBe(true)
    })

    it('hasConfiguredDxpUserId uses storage or VITE_DEFAULT_USER_ID', () => {
        expect(hasConfiguredDxpUserId({ VITE_DEFAULT_USER_ID: undefined })).toBe(false)
        setRuntimeDxpUserId(USER)
        expect(hasConfiguredDxpUserId()).toBe(true)
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
        const CURRENT = VISIT
        const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

        beforeEach(() => setRuntimeVisitId(CURRENT))

        it('is true for a VISITOR conversation from a different visit', () => {
            expect(isOtherVisitConversation({ contextType: 'VISITOR', contextTypeId: OTHER })).toBe(true)
            expect(isOtherVisitConversation({ contextType: 'VISIT', contextTypeId: OTHER })).toBe(true)
        })

        it('is false for a VISITOR conversation matching the current visit', () => {
            expect(isOtherVisitConversation({ contextType: 'VISITOR', contextTypeId: CURRENT })).toBe(false)
        })

        it('is false for null / new / non-VISITOR / id-less conversations', () => {
            expect(isOtherVisitConversation(null)).toBe(false)
            expect(isOtherVisitConversation({})).toBe(false)
            expect(isOtherVisitConversation({ contextType: 'STUDENT', contextTypeId: OTHER })).toBe(false)
            expect(isOtherVisitConversation({ contextType: 'VISITOR', contextTypeId: null })).toBe(false)
        })

        it('is false when no current visit is configured (cannot gate)', () => {
            setRuntimeVisitId('')
            const env = { VITE_DEFAULT_VISIT_ID: undefined }
            expect(isOtherVisitConversation({ contextType: 'VISITOR', contextTypeId: OTHER }, env)).toBe(false)
        })
    })
})
