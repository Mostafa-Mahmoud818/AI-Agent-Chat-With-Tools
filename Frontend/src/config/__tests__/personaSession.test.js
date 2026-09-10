import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    applyPersonaQueryOverrides,
    getChatContextForStart,
    isOtherContextConversation,
    PERSONA_STUDENT,
    PERSONA_VISIT,
    setActivePersona,
    getAvailablePersonas,
} from '../personaSession.js'
import {
    setRuntimeVisitId,
    setRuntimeStudentId,
    setStudentEligible,
    resolveVisitId,
    getRuntimeStudentId,
    getStudentEligible,
} from '../chatContext.js'

const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const STUDENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
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
        expect(getAvailablePersonas()).toEqual([PERSONA_VISIT])
        setStudentEligible(true)
        setRuntimeStudentId(STUDENT)
        expect(getAvailablePersonas()).toEqual([PERSONA_VISIT, PERSONA_STUDENT])
    })

    it('getChatContextForStart builds STUDENT envelope', () => {
        setRuntimeStudentId(STUDENT)
        setStudentEligible(true)
        setActivePersona(PERSONA_STUDENT)
        const ctx = getChatContextForStart()
        expect(ctx).toEqual({
            schemaVersion: '1.0',
            contextType: 'STUDENT',
            contextData: { id: STUDENT },
        })
        expect(ctx.contextData).not.toHaveProperty('visitId')
    })

    it('getChatContextForStart builds VISIT envelope', () => {
        setRuntimeVisitId(VISIT)
        setActivePersona(PERSONA_VISIT)
        const ctx = getChatContextForStart({ VITE_DEFAULT_VISIT_ID: undefined })
        expect(ctx.contextType).toBe('VISIT')
        expect(ctx.contextData.id).toBe(VISIT)
    })

    it('isOtherContextConversation gates cross-persona and cross-id chats', () => {
        setRuntimeVisitId(VISIT)
        setStudentEligible(true)
        setRuntimeStudentId(STUDENT)
        setActivePersona(PERSONA_VISIT)

        expect(isOtherContextConversation({ contextType: 'VISIT', contextTypeId: OTHER })).toBe(true)
        expect(isOtherContextConversation({ contextType: 'VISIT', contextTypeId: VISIT })).toBe(false)
        expect(isOtherContextConversation({ contextType: 'STUDENT', contextTypeId: STUDENT })).toBe(true)

        setActivePersona(PERSONA_STUDENT)
        expect(isOtherContextConversation({ contextType: 'STUDENT', contextTypeId: STUDENT })).toBe(false)
        expect(isOtherContextConversation({ contextType: 'VISIT', contextTypeId: VISIT })).toBe(true)
    })

    it('isOtherContextConversation is false for new / id-less conversations', () => {
        setRuntimeVisitId(VISIT)
        setActivePersona(PERSONA_VISIT)
        expect(isOtherContextConversation(null)).toBe(false)
        expect(isOtherContextConversation({})).toBe(false)
        expect(isOtherContextConversation({ contextType: 'VISIT', contextTypeId: null })).toBe(false)
        setRuntimeVisitId('')
        const env = { VITE_DEFAULT_VISIT_ID: undefined }
        expect(resolveVisitId(env)).toMatch(/^00000000/)
        expect(isOtherContextConversation({ contextType: 'VISIT', contextTypeId: OTHER }, env)).toBe(false)
    })

    it('?studentId= marks STUDENT eligible without storing the query UUID', () => {
        vi.stubGlobal('location', {
            ...window.location,
            search: `?studentId=${STUDENT}`,
        })
        applyPersonaQueryOverrides()
        expect(getStudentEligible()).toBe(true)
        expect(getRuntimeStudentId()).toBe('')
    })
})
