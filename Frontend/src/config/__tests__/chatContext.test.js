import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    buildVisitChatContext,
    DEFAULT_VISIT_ID,
    getRuntimeVisitId,
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

    it('buildVisitChatContext uses VISIT envelope', () => {
        setRuntimeVisitId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        const ctx = buildVisitChatContext()
        expect(ctx).toEqual({
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: { visitId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
        })
    })

    it('resolveVisitId prefers query param over storage', () => {
        setRuntimeVisitId('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
        vi.stubGlobal('location', {
            ...window.location,
            search: '?visitId=bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        })
        expect(resolveVisitId()).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
    })

    it('falls back to default nil UUID', () => {
        expect(resolveVisitId()).toBe(DEFAULT_VISIT_ID)
    })

    it('persists runtime visit id in localStorage', () => {
        setRuntimeVisitId('cccccccc-cccc-cccc-cccc-cccccccccccc')
        expect(getRuntimeVisitId()).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc')
        expect(localStorage.getItem(STORAGE_KEY)).toBe('cccccccc-cccc-cccc-cccc-cccccccccccc')
    })
})
