import { describe, it, expect, beforeEach, vi } from 'vitest'
import { refreshAccessToken, ensureFreshAccessToken } from '../tokenRefresh.js'
import { setTokens, getAccessToken, getRefreshToken, getAccessTokenExpiresAt, initTokenStore } from '../tokenStore.js'

const ENV = { VITE_API_BACKEND: 'remote-dev' }
const REFRESH_URL = 'https://dev-modulith.naitive.ai/api/v1/public/identity/auth/token/refresh'

vi.mock('../../config/apiOrigin.js', () => ({
    resolveModulithRequestBase: vi.fn(() => 'https://dev-modulith.naitive.ai'),
}))

function okResponse(data) {
    return { ok: true, json: async () => ({ success: true, data }) }
}

describe('tokenRefresh', () => {
    beforeEach(() => {
        localStorage.clear()
        setTokens({ accessToken: '', refreshToken: '', expiresIn: null })
    })

    it('refreshAccessToken posts the stored refresh token and stores the new pair', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        global.fetch = vi.fn(async () => okResponse({
            access_token: 'fresh-access',
            refresh_token: 'refresh-2',
            expires_in: 86400,
        }))

        const result = await refreshAccessToken(ENV)

        expect(global.fetch).toHaveBeenCalledWith(REFRESH_URL, expect.objectContaining({
            method: 'POST',
            body: JSON.stringify({ refreshToken: 'refresh-1' }),
        }))
        expect(result).toBe('fresh-access')
        expect(getAccessToken()).toBe('fresh-access')
        // Rotation: the OLD refresh token must be replaced, never reused.
        expect(getRefreshToken()).toBe('refresh-2')
        expect(getAccessTokenExpiresAt()).toBeGreaterThan(Date.now())
    })

    it('concurrent refreshAccessToken calls share one in-flight request (rotation-safe)', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        let callCount = 0
        global.fetch = vi.fn(async () => {
            callCount += 1
            await new Promise((resolve) => setTimeout(resolve, 5))
            return okResponse({ access_token: 'fresh-access', refresh_token: 'refresh-2', expires_in: 86400 })
        })

        const [a, b] = await Promise.all([refreshAccessToken(ENV), refreshAccessToken(ENV)])

        expect(callCount).toBe(1)
        expect(a).toBe('fresh-access')
        expect(b).toBe('fresh-access')
    })

    it('rejects without calling fetch when no refresh token is stored', async () => {
        global.fetch = vi.fn()

        await expect(refreshAccessToken(ENV)).rejects.toThrow('No refresh token available')
        expect(global.fetch).not.toHaveBeenCalled()
    })

    it('clears tokens and throws when the backend rejects the refresh token', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ message: 'invalid_grant' }),
        }))

        await expect(refreshAccessToken(ENV)).rejects.toThrow('invalid_grant')
        expect(getAccessToken()).toBe('')
        expect(getRefreshToken()).toBe('')
    })

    it('sends the token another tab persisted, not the stale runtime copy', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        // Simulate a sibling tab rotating the token: storage moves on, this tab's runtime copy doesn't.
        localStorage.setItem('ankabut.chat.refreshToken', 'refresh-2')
        global.fetch = vi.fn(async () => okResponse({
            access_token: 'fresh-access',
            refresh_token: 'refresh-3',
            expires_in: 86400,
        }))

        await refreshAccessToken(ENV)

        expect(global.fetch).toHaveBeenCalledWith(REFRESH_URL, expect.objectContaining({
            body: JSON.stringify({ refreshToken: 'refresh-2' }),
        }))
    })

    it('keeps the session when a losing tab is rejected after another tab already rotated', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        global.fetch = vi.fn(async () => {
            // The winning tab persists its new pair while this request is in flight.
            localStorage.setItem('ankabut.chat.accessToken', 'winner-access')
            localStorage.setItem('ankabut.chat.refreshToken', 'winner-refresh')
            return { ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }
        })

        await expect(refreshAccessToken(ENV)).rejects.toThrow('invalid_grant')
        // The winner's tokens must survive — clearing here would sign both tabs out.
        expect(localStorage.getItem('ankabut.chat.accessToken')).toBe('winner-access')
        expect(localStorage.getItem('ankabut.chat.refreshToken')).toBe('winner-refresh')
    })

    it('surfaces the bare OAuth2 error body the auth server returns', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 400,
            json: async () => ({ error: 'invalid_grant' }),
        }))

        await expect(refreshAccessToken(ENV)).rejects.toThrow('invalid_grant')
    })

    it('clears tokens and throws when the response is missing access_token/refresh_token', async () => {
        setTokens({ accessToken: 'stale-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        global.fetch = vi.fn(async () => okResponse({}))

        await expect(refreshAccessToken(ENV)).rejects.toThrow('missing access_token/refresh_token')
        expect(getAccessToken()).toBe('')
    })

    it('ensureFreshAccessToken returns the current token without a network call when not expired', async () => {
        setTokens({ accessToken: 'still-fresh', refreshToken: 'refresh-1', expiresIn: 3600 })
        global.fetch = vi.fn()

        const token = await ensureFreshAccessToken(ENV)

        expect(token).toBe('still-fresh')
        expect(global.fetch).not.toHaveBeenCalled()
    })

    it('ensureFreshAccessToken returns "" without a network call when never signed in', async () => {
        global.fetch = vi.fn()

        const token = await ensureFreshAccessToken(ENV)

        expect(token).toBe('')
        expect(global.fetch).not.toHaveBeenCalled()
    })

    it('ensureFreshAccessToken refreshes when the stored token is expired', async () => {
        setTokens({ accessToken: 'expired-access', refreshToken: 'refresh-1', expiresIn: 3600 })
        // Simulate a reload after the token actually expired: force the persisted expiry into the past.
        localStorage.setItem('ankabut.chat.accessTokenExpiresAt', String(Date.now() - 60_000))
        initTokenStore({})

        global.fetch = vi.fn(async () => okResponse({
            access_token: 'fresh-access',
            refresh_token: 'refresh-2',
            expires_in: 86400,
        }))

        const token = await ensureFreshAccessToken(ENV)

        expect(token).toBe('fresh-access')
        expect(global.fetch).toHaveBeenCalledTimes(1)
    })
})
