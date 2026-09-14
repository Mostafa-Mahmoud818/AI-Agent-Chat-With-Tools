import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    applyPersonaQueryOverrides,
    getChatContextForStart,
    hasConfiguredActivePersonaContext,
    isOtherContextConversation,
    PERSONA_STUDENT,
    PERSONA_VISITOR,
    PERSONA_VISIT,
    setActivePersona,
    getAvailablePersonas,
    getActivePersona,
} from '../personaSession.js'
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
})
