import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setRuntimeVisitId, setRuntimeStudentId, getRuntimeVisitId, getRuntimeStudentId, STORAGE_KEY, STUDENT_STORAGE_KEY } from '../../config/chatContext.js'
import { clearSecureAuthSession, completeSecureAuth } from '../../auth/secureAuthSession.js'
import { getAccessToken } from '../../auth/tokenStore.js'
import { getActivePersona, PERSONA_STUDENT, PERSONA_VISIT } from '../../config/personaSession.js'

const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const STUDENT = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

vi.mock('../../auth/visitResolution.js', () => ({
    tryResolveVisitIdForCurrentUser: vi.fn(async (_env, _token, opts) => {
        // Simulate student-only: no visit when attempts is 1 and we return null from a separate mock control.
        const { visitResult } = globalThis.__secureAuthMocks || { visitResult: VISIT }
        if (visitResult) {
            setRuntimeVisitId(visitResult)
            return visitResult
        }
        return null
    }),
    resolveVisitIdForCurrentUser: vi.fn(async () => {
        setRuntimeVisitId(VISIT)
        return VISIT
    }),
}))

vi.mock('../../auth/studentResolution.js', () => ({
    tryResolveStudentIdForCurrentUser: vi.fn(async () => {
        const { studentResult } = globalThis.__secureAuthMocks || { studentResult: null }
        if (studentResult) {
            localStorage.setItem('ankabut.chat.studentEligible', 'true')
            localStorage.setItem('ankabut.chat.dxpUserId', studentResult)
            return studentResult
        }
        return null
    }),
}))

describe('secureAuthSession', () => {
    beforeEach(() => {
        localStorage.clear()
        globalThis.__secureAuthMocks = { visitResult: VISIT, studentResult: null }
    })

    it('completeSecureAuth stores token and visit id (visitor-only)', async () => {
        const result = await completeSecureAuth({}, 'test-jwt-token')
        expect(result.accessToken).toBe('test-jwt-token')
        expect(result.visitId).toBe(VISIT)
        expect(result.studentId).toBeNull()
        expect(result.availablePersonas).toEqual([PERSONA_VISIT])
        expect(getAccessToken()).toBe('test-jwt-token')
        expect(getRuntimeVisitId()).toBe(VISIT)
        expect(getActivePersona()).toBe(PERSONA_VISIT)
    })

    it('completeSecureAuth succeeds for student-only without a visit', async () => {
        globalThis.__secureAuthMocks = { visitResult: null, studentResult: STUDENT }
        const result = await completeSecureAuth({}, 'student-jwt')
        expect(result.visitId).toBeNull()
        expect(result.studentId).toBe(STUDENT)
        expect(result.availablePersonas).toEqual([PERSONA_STUDENT])
        expect(getRuntimeStudentId()).toBe(STUDENT)
        expect(getActivePersona()).toBe(PERSONA_STUDENT)
    })

    it('completeSecureAuth exposes both personas when both resolve', async () => {
        globalThis.__secureAuthMocks = { visitResult: VISIT, studentResult: STUDENT }
        const result = await completeSecureAuth({}, 'dual-jwt')
        expect(result.availablePersonas).toEqual([PERSONA_VISIT, PERSONA_STUDENT])
        // Prefer VISIT when both exist and no prior choice.
        expect(getActivePersona()).toBe(PERSONA_VISIT)
    })

    it('completeSecureAuth fails when neither visit nor student resolves', async () => {
        globalThis.__secureAuthMocks = { visitResult: null, studentResult: null }
        await expect(completeSecureAuth({}, 'empty-jwt')).rejects.toThrow(/No visit or student/)
        expect(getAccessToken()).toBe('empty-jwt') // tokens already stored before resolution
    })

    it('clearSecureAuthSession removes token, visit id, and student id', () => {
        localStorage.setItem('ankabut.chat.accessToken', 'tok')
        localStorage.setItem(STORAGE_KEY, VISIT)
        localStorage.setItem(STUDENT_STORAGE_KEY, STUDENT)
        localStorage.setItem('ankabut.chat.studentEligible', 'true')
        localStorage.setItem('ankabut.chat.activePersona', PERSONA_STUDENT)
        clearSecureAuthSession()
        expect(getAccessToken()).toBe('')
        expect(getRuntimeVisitId()).toBe('')
        expect(getRuntimeStudentId()).toBe('')
        expect(getActivePersona()).toBeNull()
    })
})
