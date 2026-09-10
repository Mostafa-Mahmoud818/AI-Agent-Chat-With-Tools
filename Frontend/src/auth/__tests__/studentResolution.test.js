import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    persistStudentEligibility,
    tryResolveStudentIdForCurrentUser,
} from '../studentResolution.js'
import {
    getRuntimeStudentId,
    getStudentEligible,
    LEGACY_STUDENT_STORAGE_KEY,
    setRuntimeStudentId,
    setStudentEligible,
    STUDENT_STORAGE_KEY,
} from '../../config/chatContext.js'

const DXP = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

describe('studentResolution', () => {
    beforeEach(() => {
        localStorage.clear()
        setStudentEligible(false)
        setRuntimeStudentId(null)
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('persistStudentEligibility true when personas includes STUDENT', () => {
        persistStudentEligibility({ personas: ['STUDENT', 'VISITOR'], reasons: ['USER_EXISTS'] })
        expect(getStudentEligible()).toBe(true)
    })

    it('persistStudentEligibility true when reasons includes STUDENT_EXISTS', () => {
        persistStudentEligibility({ personas: [], reasons: ['USER_EXISTS', 'STUDENT_EXISTS'] })
        expect(getStudentEligible()).toBe(true)
    })

    it('persistStudentEligibility false when only USER_EXISTS', () => {
        persistStudentEligibility({ personas: [], reasons: ['USER_EXISTS'] })
        expect(getStudentEligible()).toBe(false)
    })

    it('does not call profile/me when not eligible', async () => {
        global.fetch = vi.fn()
        const id = await tryResolveStudentIdForCurrentUser({ VITE_API_BACKEND: 'local' }, 'jwt')
        expect(id).toBeNull()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(getRuntimeStudentId()).toBe('')
    })

    it('stores Identity UUID from profile/me data.id when eligible', async () => {
        setStudentEligible(true)
        global.fetch = vi.fn(async () => ({
            status: 200,
            ok: true,
            json: async () => ({
                success: true,
                data: { id: DXP, username: 'ada' },
            }),
        }))

        const id = await tryResolveStudentIdForCurrentUser({ VITE_API_BACKEND: 'local' }, 'jwt')

        expect(id).toBe(DXP)
        expect(getRuntimeStudentId()).toBe(DXP)
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringMatching(/\/api\/v1\/secure\/identity\/profile\/me$/),
            expect.objectContaining({
                headers: { Authorization: 'Bearer jwt' },
            }),
        )
    })

    it('wipes leftover roster PK key', async () => {
        localStorage.setItem(LEGACY_STUDENT_STORAGE_KEY, DXP)
        setStudentEligible(true)
        global.fetch = vi.fn(async () => ({
            status: 200,
            ok: true,
            json: async () => ({ success: true, data: { id: DXP } }),
        }))

        await tryResolveStudentIdForCurrentUser({ VITE_API_BACKEND: 'local' }, 'jwt')

        expect(localStorage.getItem(LEGACY_STUDENT_STORAGE_KEY)).toBeNull()
        expect(localStorage.getItem(STUDENT_STORAGE_KEY)).toBe(DXP)
    })

    it('keeps stored Identity UUID when profile/me fails', async () => {
        setStudentEligible(true)
        setRuntimeStudentId(DXP)
        global.fetch = vi.fn(async () => ({ status: 503, ok: false }))

        const id = await tryResolveStudentIdForCurrentUser({ VITE_API_BACKEND: 'local' }, 'jwt')

        expect(id).toBe(DXP)
        expect(getRuntimeStudentId()).toBe(DXP)
    })

    it('clears stored UUID when not eligible even if a leftover id remains', async () => {
        setRuntimeStudentId(DXP)
        localStorage.removeItem('ankabut.chat.studentEligible')
        global.fetch = vi.fn()

        const id = await tryResolveStudentIdForCurrentUser({ VITE_API_BACKEND: 'local' }, 'jwt')

        expect(id).toBeNull()
        expect(global.fetch).not.toHaveBeenCalled()
        expect(getRuntimeStudentId()).toBe('')
    })
})
