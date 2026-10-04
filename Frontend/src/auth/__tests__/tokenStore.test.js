import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    initTokenStore,
    getAccessToken,
    getRefreshToken,
    getAccessTokenExpiresAt,
    setAccessToken,
    setTokens,
    clearTokens,
    onTokensCleared,
} from '../tokenStore.js'

describe('tokenStore', () => {
    beforeEach(() => {
        localStorage.clear()
        initTokenStore({})
    })

    it('setTokens stores access token, refresh token, and a computed expiry', () => {
        const before = Date.now()
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })

        expect(getAccessToken()).toBe('access-1')
        expect(getRefreshToken()).toBe('refresh-1')
        expect(getAccessTokenExpiresAt()).toBeGreaterThanOrEqual(before + 3600 * 1000)
        expect(localStorage.getItem('ankabut.chat.accessToken')).toBe('access-1')
        expect(localStorage.getItem('ankabut.chat.refreshToken')).toBe('refresh-1')
    })

    it('setTokens without expiresIn leaves expiry unknown (0)', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1' })
        expect(getAccessTokenExpiresAt()).toBe(0)
    })

    it('setTokens without a refresh token clears any previously stored one', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        setTokens({ accessToken: 'access-2' })

        expect(getAccessToken()).toBe('access-2')
        expect(getRefreshToken()).toBe('')
        expect(getAccessTokenExpiresAt()).toBe(0)
    })

    it('clearTokens removes access token, refresh token, and expiry', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        clearTokens()

        expect(getAccessToken()).toBe('')
        expect(getRefreshToken()).toBe('')
        expect(getAccessTokenExpiresAt()).toBe(0)
        expect(localStorage.getItem('ankabut.chat.accessToken')).toBeNull()
        expect(localStorage.getItem('ankabut.chat.refreshToken')).toBeNull()
    })

    it('setAccessToken alone does not disturb a previously stored refresh token', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        setAccessToken('access-2')

        expect(getAccessToken()).toBe('access-2')
        expect(getRefreshToken()).toBe('refresh-1')
    })

    it('initTokenStore restores persisted tokens across a reload', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        initTokenStore({}) // simulate a fresh page load re-reading storage

        expect(getAccessToken()).toBe('access-1')
        expect(getRefreshToken()).toBe('refresh-1')
        expect(getAccessTokenExpiresAt()).toBeGreaterThan(0)
    })

    it('initTokenStore with an env bearer token clears any stale refresh token/expiry', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        initTokenStore({ VITE_API_BEARER_TOKEN: 'ci-token' })

        expect(getAccessToken()).toBe('ci-token')
        expect(getRefreshToken()).toBe('')
        expect(getAccessTokenExpiresAt()).toBe(0)
    })

    it('onTokensCleared calls listeners when clearTokens is invoked', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        const callback = vi.fn()
        onTokensCleared(callback)

        clearTokens()

        expect(callback).toHaveBeenCalled()
    })

    it('onTokensCleared does not call listeners when setTokens is called with a token', () => {
        setTokens({ accessToken: 'access-1' })
        const callback = vi.fn()
        onTokensCleared(callback)

        setTokens({ accessToken: 'access-2' })

        expect(callback).not.toHaveBeenCalled()
    })

    it('onTokensCleared fires once when setTokens drops the access token', () => {
        setTokens({ accessToken: 'access-1', refreshToken: 'refresh-1', expiresIn: 3600 })
        const callback = vi.fn()
        const unsubscribe = onTokensCleared(callback)

        setTokens({ accessToken: '', refreshToken: '', expiresIn: null })
        expect(callback).toHaveBeenCalledTimes(1)

        setTokens({ accessToken: 'access-2' })
        clearTokens()
        expect(callback).toHaveBeenCalledTimes(2)
        unsubscribe()
    })

    it('onTokensCleared keeps notifying other listeners when one unsubscribes or throws', () => {
        setTokens({ accessToken: 'access-1' })
        const second = vi.fn()
        let unsubscribeFirst = () => {}
        unsubscribeFirst = onTokensCleared(() => {
            unsubscribeFirst()
            throw new Error('boom')
        })
        const unsubscribeSecond = onTokensCleared(second)

        clearTokens()

        expect(second).toHaveBeenCalledTimes(1)
        unsubscribeSecond()
    })

    it('onTokensCleared returns an unsubscribe function that stops calling the listener', () => {
        const callback = vi.fn()
        const unsubscribe = onTokensCleared(callback)

        clearTokens()
        expect(callback).toHaveBeenCalledTimes(1)

        unsubscribe()
        clearTokens()
        expect(callback).toHaveBeenCalledTimes(1)
    })
})
