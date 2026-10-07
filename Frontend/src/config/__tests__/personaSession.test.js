import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    applyPersonaFromAccessToken,
    applyPersonaQueryOverrides,
    getChatContextForStart,
    hasConfiguredActivePersonaContext,
    isOtherContextConversation,
    normalizeEligiblePersonas,
    PERSONA_STUDENT,
    PERSONA_VISITOR,
    PERSONA_VISIT,
    setActivePersona,
    getAvailablePersonas,
    getActivePersona,
    getLockedPersona,
    resolveActivePersona,
    ensureActivePersona,
} from '../personaSession.js'
import { clearTokens, setAccessToken } from '../../auth/tokenStore.js'
import {
    setRuntimeVisitId,
    setRuntimeDxpUserId,
    setStudentEligible,
    resolveVisitId,
    getRuntimeDxpUserId,
    getStudentEligible,
} from '../chatContext.js'

const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const USER = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

describe('personaSession', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('location', { ...window.location, search: '' })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
        clearTokens()
    })

    it('getAvailablePersonas reflects configured ids', () => {
        expect(getAvailablePersonas()).toEqual([])
        setRuntimeVisitId(VISIT)
        expect(getAvailablePersonas()).toEqual([PERSONA_VISITOR])
        setStudentEligible(true)
        setRuntimeDxpUserId(USER)
        expect(getAvailablePersonas()).toEqual([PERSONA_VISITOR, PERSONA_STUDENT])
    })

    it('PERSONA_VISIT aliases PERSONA_VISITOR', () => {
        expect(PERSONA_VISIT).toBe(PERSONA_VISITOR)
        expect(PERSONA_VISITOR).toBe('VISITOR')
    })

    it('getActivePersona canonicalizes legacy VISIT storage', () => {
        localStorage.setItem('ankabut.chat.activePersona', 'VISIT')
        expect(getActivePersona()).toBe('VISITOR')
    })

    it('getChatContextForStart builds STUDENT envelope', () => {
        setRuntimeDxpUserId(USER)
        setStudentEligible(true)
        setActivePersona(PERSONA_STUDENT)
        const ctx = getChatContextForStart()
        expect(ctx).toEqual({
            schemaVersion: '1.0',
            contextType: 'STUDENT',
            userId: USER,
            contextData: {},
        })
    })

    it('getChatContextForStart builds VISITOR envelope', () => {
        setRuntimeVisitId(VISIT)
        setRuntimeDxpUserId(USER)
        setActivePersona(PERSONA_VISITOR)
        const ctx = getChatContextForStart({ VITE_DEFAULT_VISIT_ID: undefined })
        expect(ctx).toEqual({
            schemaVersion: '1.0',
            contextType: 'VISITOR',
            userId: USER,
            contextData: { visitId: VISIT },
        })
    })

    it('hasConfiguredActivePersonaContext requires userId', () => {
        setRuntimeVisitId(VISIT)
        setActivePersona(PERSONA_VISITOR)
        expect(hasConfiguredActivePersonaContext({ VITE_DEFAULT_USER_ID: undefined })).toBe(false)
        setRuntimeDxpUserId(USER)
        expect(hasConfiguredActivePersonaContext()).toBe(true)
    })

    it('isOtherContextConversation gates cross-persona and cross-id chats', () => {
        setRuntimeVisitId(VISIT)
        setStudentEligible(true)
        setRuntimeDxpUserId(USER)
        setActivePersona(PERSONA_VISITOR)

        expect(isOtherContextConversation({ contextType: 'VISITOR', contextTypeId: OTHER })).toBe(true)
        expect(isOtherContextConversation({ contextType: 'VISIT', contextTypeId: VISIT })).toBe(false)
        expect(isOtherContextConversation({ contextType: 'STUDENT', contextTypeId: USER })).toBe(true)

        setActivePersona(PERSONA_STUDENT)
        expect(isOtherContextConversation({ contextType: 'STUDENT', contextTypeId: USER })).toBe(false)
        expect(isOtherContextConversation({ contextType: 'VISITOR', contextTypeId: VISIT })).toBe(true)
    })

    it('isOtherContextConversation is false for new / id-less conversations', () => {
        setRuntimeVisitId(VISIT)
        setRuntimeDxpUserId(USER)
        setActivePersona(PERSONA_VISITOR)
        expect(isOtherContextConversation(null)).toBe(false)
        expect(isOtherContextConversation({})).toBe(false)
        expect(isOtherContextConversation({ contextType: 'VISITOR', contextTypeId: null })).toBe(false)
        setRuntimeVisitId('')
        const env = { VITE_DEFAULT_VISIT_ID: undefined }
        expect(resolveVisitId(env)).toMatch(/^00000000/)
        expect(isOtherContextConversation({ contextType: 'VISITOR', contextTypeId: OTHER }, env)).toBe(false)
    })

    it('?studentId= marks STUDENT eligible without storing the query UUID', () => {
        vi.stubGlobal('location', {
            ...window.location,
            search: `?studentId=${USER}`,
        })
        applyPersonaQueryOverrides()
        expect(getStudentEligible()).toBe(true)
        expect(getRuntimeDxpUserId()).toBe('')
    })

    it('?persona=VISIT stores canonical VISITOR', () => {
        vi.stubGlobal('location', {
            ...window.location,
            search: '?persona=VISIT',
        })
        applyPersonaQueryOverrides()
        expect(getActivePersona()).toBe('VISITOR')
    })

    it('normalizeEligiblePersonas canonicalizes VISIT and dedupes', () => {
        expect(normalizeEligiblePersonas(['VISIT', 'student', 'VISITOR', 'EMPLOYEE'])).toEqual([
            'VISITOR',
            'STUDENT',
            'EMPLOYEE',
        ])
        expect(normalizeEligiblePersonas(null)).toEqual([])
    })

    it('applyPersonaFromAccessToken sets STUDENT from JWT claim', () => {
        const encode = (obj) =>
            btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        const token = `${encode({ alg: 'none' })}.${encode({ persona_code: 'STUDENT' })}.sig`
        expect(applyPersonaFromAccessToken(token)).toBe('STUDENT')
        expect(getActivePersona()).toBe('STUDENT')
    })

    describe('persona locked by the sign-in token', () => {
        const encode = (obj) =>
            btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
        const tokenFor = (persona) => `${encode({ alg: 'none' })}.${encode({ persona_code: persona })}.sig`

        beforeEach(() => {
            setRuntimeVisitId(VISIT)
            setStudentEligible(true)
            setRuntimeDxpUserId(USER)
        })

        it('uses the JWT persona even when both contexts resolved and another was stored', () => {
            setAccessToken(tokenFor('STUDENT'))
            setActivePersona(PERSONA_VISITOR)

            expect(getLockedPersona()).toBe(PERSONA_STUDENT)
            expect(resolveActivePersona()).toBe(PERSONA_STUDENT)
            expect(ensureActivePersona()).toBe(PERSONA_STUDENT)
            expect(getChatContextForStart().contextType).toBe('STUDENT')
        })

        it('offers only the locked persona as available', () => {
            setAccessToken(tokenFor('VISITOR'))
            expect(getAvailablePersonas()).toEqual([PERSONA_VISITOR])
        })

        it('stays on the locked persona before its context resolves (no fallback to the other one)', () => {
            setRuntimeVisitId('')
            setAccessToken(tokenFor('VISITOR'))
            expect(getAvailablePersonas()).toEqual([])
            expect(resolveActivePersona()).toBe(PERSONA_VISITOR)
            expect(hasConfiguredActivePersonaContext({ VITE_DEFAULT_VISIT_ID: undefined })).toBe(false)
        })

        it('ignores ?persona= for a different persona', () => {
            setAccessToken(tokenFor('STUDENT'))
            vi.stubGlobal('location', { ...window.location, search: '?persona=VISITOR' })
            applyPersonaQueryOverrides()
            expect(resolveActivePersona()).toBe(PERSONA_STUDENT)
        })

        it('falls back to resolved contexts when the token has no persona_code', () => {
            setAccessToken('opaque-ci-token')
            setActivePersona(PERSONA_STUDENT)
            expect(getLockedPersona()).toBeNull()
            expect(resolveActivePersona()).toBe(PERSONA_STUDENT)
            expect(getAvailablePersonas()).toEqual([PERSONA_VISITOR, PERSONA_STUDENT])
        })
    })
})
