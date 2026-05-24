import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
    exchangeOtpForToken,
    prepareOtpChallenge,
} from '../otpAccessTokenFlow.js'

const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

vi.mock('../secureAuthSession.js', () => ({
    completeSecureAuth: vi.fn(async (_env, token) => ({
        accessToken: token,
        visitId: VISIT,
    })),
}))

vi.mock('../../config/apiOrigin.js', () => ({
    resolveModulithRequestBase: vi.fn((env) => {
        if (env.VITE_API_BACKEND === 'local') return 'http://localhost:8085'
        return 'https://dev-modulith.naitive.ai'
    }),
    resolveActiveBackendPreset: vi.fn((env) => {
        if (env.VITE_API_BACKEND === 'local') return 'local'
        if (env.VITE_API_BACKEND === 'remote-test') return 'remote-test'
        return 'remote-dev'
    }),
}))

describe('otpAccessTokenFlow', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        global.fetch = vi.fn(async (url) => {
            if (String(url).includes('/otp/email/token')) {
                return {
                    ok: true,
                    json: async () => ({ data: { access_token: 'jwt-from-otp' } }),
                }
            }
            return {
                ok: true,
                json: async () => ({ data: { eligible: true, reason: 'USER_EXISTS' } }),
            }
        })
    })

    it('prepareOtpChallenge posts check-eligibility only for DEV', async () => {
        const env = { VITE_API_BACKEND: 'remote-dev' }
        await prepareOtpChallenge(env, 'user@example.com')

        expect(global.fetch).toHaveBeenCalledTimes(1)
        expect(global.fetch).toHaveBeenCalledWith(
            'https://dev-modulith.naitive.ai/api/v1/public/visitor-management/check-eligibility',
            expect.objectContaining({ method: 'POST' }),
        )
    })

    it('prepareOtpChallenge posts provision and check-eligibility for LOCAL preset', async () => {
        const env = { VITE_API_BACKEND: 'local' }
        await prepareOtpChallenge(env, 'user@example.com')

        expect(global.fetch).toHaveBeenCalledTimes(2)
        expect(global.fetch).toHaveBeenNthCalledWith(
            1,
            'http://localhost:8085/v1/internal/identity/email/provision',
            expect.any(Object),
        )
        expect(global.fetch).toHaveBeenNthCalledWith(
            2,
            'http://localhost:8085/api/v1/public/visitor-management/check-eligibility',
            expect.any(Object),
        )
    })

    it('prepareOtpChallenge throws when eligibility is false', async () => {
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: { eligible: false, reason: 'NO_RECORDS' } }),
        }))

        await expect(
            prepareOtpChallenge({ VITE_API_BACKEND: 'remote-dev' }, 'unknown@example.com'),
        ).rejects.toThrow('No account or visit history found for this email.')
    })

    it('prepareOtpChallenge surfaces backend error message on HTTP failure', async () => {
        global.fetch = vi.fn(async () => ({
            ok: false,
            status: 500,
            json: async () => ({ message: 'An unexpected error occurred' }),
        }))

        await expect(
            prepareOtpChallenge({ VITE_API_BACKEND: 'remote-dev' }, 'user@example.com'),
        ).rejects.toThrow('An unexpected error occurred')
    })

    it('exchangeOtpForToken posts token endpoint and completes secure auth', async () => {
        const env = { VITE_API_BACKEND: 'remote-dev' }
        const result = await exchangeOtpForToken(env, 'user@example.com', '123456')

        expect(global.fetch).toHaveBeenCalledWith(
            'https://dev-modulith.naitive.ai/api/v1/public/identity/auth/otp/email/token',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({ email: 'user@example.com', code: '123456' }),
            }),
        )
        expect(result).toEqual({
            accessToken: 'jwt-from-otp',
            visitId: VISIT,
        })
    })

    it('exchangeOtpForToken throws when access_token missing', async () => {
        global.fetch = vi.fn(async () => ({
            ok: true,
            json: async () => ({ data: {} }),
        }))

        await expect(
            exchangeOtpForToken({}, 'user@example.com', '123456'),
        ).rejects.toThrow('No access_token in response')
    })

    it('prepareOtpChallenge throws on empty email', async () => {
        await expect(prepareOtpChallenge({}, '')).rejects.toThrow('Email is required')
    })
})
