import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setRuntimeVisitId } from '../../config/chatContext.js'
import { clearSecureAuthSession, completeSecureAuth } from '../../auth/secureAuthSession.js'
import { getAccessToken } from '../../auth/tokenStore.js'
import { getRuntimeVisitId, STORAGE_KEY } from '../../config/chatContext.js'

const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

vi.mock('../../auth/visitResolution.js', () => ({
    resolveVisitIdForCurrentUser: vi.fn(async () => {
        setRuntimeVisitId(VISIT)
        return VISIT
    }),
}))

describe('secureAuthSession', () => {
    beforeEach(() => {
        localStorage.clear()
    })

    it('completeSecureAuth stores token and visit id', async () => {
        const result = await completeSecureAuth({}, 'test-jwt-token')
        expect(result).toEqual({
            accessToken: 'test-jwt-token',
            visitId: VISIT,
        })
        expect(getAccessToken()).toBe('test-jwt-token')
        expect(getRuntimeVisitId()).toBe(VISIT)
    })

    it('clearSecureAuthSession removes token and visit id', () => {
        localStorage.setItem('ankabut.chat.accessToken', 'tok')
        localStorage.setItem(STORAGE_KEY, VISIT)
        clearSecureAuthSession()
        expect(getAccessToken()).toBe('')
        expect(getRuntimeVisitId()).toBe('')
    })
})
