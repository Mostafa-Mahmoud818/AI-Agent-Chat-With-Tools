import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
    beginUaePassCallback,
    completeUaePassSignIn,
    endUaePassSession,
    startUaePassSignIn,
    takePendingUaePassSignIn,
    wasUaePassSession,
} from '../uaePassFlow.js'
import { clearSecureAuthSession } from '../secureAuthSession.js'
import { getAccessToken, setTokens } from '../tokenStore.js'
import { getStudentEligible, setStudentEligible } from '../../config/chatContext.js'
import { tryResolveStudentIdForCurrentUser } from '../studentResolution.js'

const PENDING_KEY = 'ankabut.chat.uaepass.pending'
const BASE = 'https://dev-modulith.naitive.ai'
const TOKEN_URL = `${BASE}/api/v1/public/identity/auth/uaepass/token`
const VISIT = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
const GENERIC = 'Something went wrong during the login, please try again later!'
const CANCEL = 'User cancelled the login.'

vi.mock('../../config/apiOrigin.js', async (importOriginal) => ({
    ...(await importOriginal()),
    resolveModulithRequestBase: () => 'https://dev-modulith.naitive.ai',
    resolveActiveBackendPreset: () => 'remote-dev',
}))

vi.mock('../visitResolution.js', async (importOriginal) => ({
    ...(await importOriginal()),
    tryResolveVisitIdForCurrentUser: vi.fn(async () => VISIT),
}))

vi.mock('../studentResolution.js', async (importOriginal) => ({
    ...(await importOriginal()),
    tryResolveStudentIdForCurrentUser: vi.fn(async () => null),
    tryResolveDxpUserIdForCurrentUser: vi.fn(async () => null),
}))

/** jsdom does not navigate; record assign() and read the real URL through getters. */
let realLocation
let assignSpy

function stubLocationAssign() {
    realLocation = window.location
    assignSpy = vi.fn()
    const fake = {
        get href() { return realLocation.href },
        get origin() { return realLocation.origin },
        get pathname() { return realLocation.pathname },
        get search() { return realLocation.search },
        get hash() { return realLocation.hash },
        assign: assignSpy,
    }
    Object.defineProperty(window, 'location', { configurable: true, get: () => fake })
}

function restoreLocation() {
    Object.defineProperty(window, 'location', { configurable: true, value: realLocation })
}

function setUrl(path) {
    window.history.replaceState({}, '', path)
}

function storePending(overrides = {}) {
    sessionStorage.setItem(
        PENDING_KEY,
        JSON.stringify({
            state: 'st-1',
            redirectUri: `${window.location.origin}/`,
            startedAt: Date.now(),
            ...overrides,
        }),
    )
}

function b64url(obj) {
    return Buffer.from(JSON.stringify(obj)).toString('base64url')
}

function jwt(payload) {
    return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`
}

function tokenResponse(accessToken = 'uae-jwt') {
    return {
        ok: true,
        status: 200,
        json: async () => ({
            data: { access_token: accessToken, refresh_token: 'refresh-1', expires_in: 300 },
        }),
    }
}

describe('uaePassFlow', () => {
    beforeEach(() => {
        localStorage.clear()
        sessionStorage.clear()
        clearSecureAuthSession()
        setUrl('/')
        stubLocationAssign()
        global.fetch = vi.fn(async () => tokenResponse())
    })

    afterEach(() => {
        takePendingUaePassSignIn() // drop module state a test left behind
        restoreLocation()
        vi.unstubAllEnvs()
        vi.clearAllMocks()
    })

    describe('startUaePassSignIn', () => {
        it('redirects to the authorize endpoint with every parameter and stores the pending state', () => {
            vi.stubEnv('VITE_UAEPASS_CLIENT_ID', '')
            startUaePassSignIn()

            expect(assignSpy).toHaveBeenCalledTimes(1)
            const url = new URL(assignSpy.mock.calls[0][0])
            expect(`${url.origin}${url.pathname}`).toBe('https://stg-id.uaepass.ae/idshub/authorize')
            expect(url.searchParams.get('response_type')).toBe('code')
            expect(url.searchParams.get('client_id')).toBe('sandbox_stage')
            expect(url.searchParams.get('redirect_uri')).toBe(`${window.location.origin}/`)
            expect(url.searchParams.get('scope')).toBe('urn:uae:digitalid:profile:general')
            expect(url.searchParams.get('acr_values')).toBe('urn:safelayer:tws:policies:authentication:level:low')
            expect(url.searchParams.get('ui_locales')).toBe('en')

            const pending = JSON.parse(sessionStorage.getItem(PENDING_KEY))
            expect(url.searchParams.get('state')).toBe(pending.state)
            expect(pending.redirectUri).toBe(`${window.location.origin}/`)
            expect(Number(pending.startedAt)).toBeGreaterThan(0)
        })

        it('stores the chosen persona with the pending state', () => {
            startUaePassSignIn('VISITOR')
            expect(JSON.parse(sessionStorage.getItem(PENDING_KEY)).personaCode).toBe('VISITOR')
        })

        it('stores no persona when none is chosen', () => {
            startUaePassSignIn()
            expect(JSON.parse(sessionStorage.getItem(PENDING_KEY))).not.toHaveProperty('personaCode')
        })

        it('uses the configured client id when VITE_UAEPASS_CLIENT_ID is set', () => {
            vi.stubEnv('VITE_UAEPASS_CLIENT_ID', 'other-client')
            startUaePassSignIn()
            expect(new URL(assignSpy.mock.calls[0][0]).searchParams.get('client_id')).toBe('other-client')
        })

        it('generates a new 256-bit base64url state on every call', () => {
            startUaePassSignIn()
            const first = JSON.parse(sessionStorage.getItem(PENDING_KEY)).state
            startUaePassSignIn()
            const second = JSON.parse(sessionStorage.getItem(PENDING_KEY)).state

            expect(first).not.toBe(second)
            expect(first).toMatch(/^[A-Za-z0-9_-]{43}$/)
        })
    })

    describe('beginUaePassCallback', () => {
        it('does nothing without callback parameters', () => {
            setUrl('/?persona=STUDENT')
            storePending()
            beginUaePassCallback(import.meta.env)

            expect(global.fetch).not.toHaveBeenCalled()
            expect(window.location.search).toBe('?persona=STUDENT')
            expect(sessionStorage.getItem(PENDING_KEY)).not.toBeNull()
            expect(takePendingUaePassSignIn()).toBeNull()
        })

        it('exchanges a valid code with the exact body {code, redirect_uri} and resolves the tokens', async () => {
            let searchAtRequest = null
            global.fetch = vi.fn(async () => {
                searchAtRequest = window.location.search
                return tokenResponse()
            })
            storePending({ state: 'st-ok' })
            setUrl('/?code=the-code&state=st-ok')
            beginUaePassCallback(import.meta.env)

            expect(global.fetch).toHaveBeenCalledTimes(1)
            expect(searchAtRequest).toBe('')
            const [url, init] = global.fetch.mock.calls[0]
            expect(url).toBe(TOKEN_URL)
            expect(JSON.parse(init.body)).toEqual({
                code: 'the-code',
                redirect_uri: `${window.location.origin}/`,
            })

            const tokens = await takePendingUaePassSignIn()
            expect(tokens).toEqual({ accessToken: 'uae-jwt', refreshToken: 'refresh-1', expiresIn: 300, matchedPersonas: [] })
        })

        it('sends the persona chosen before the redirect and returns matched_personas', async () => {
            global.fetch = vi.fn(async () => ({
                ok: true,
                status: 200,
                json: async () => ({
                    data: { access_token: 'uae-jwt', refresh_token: 'r', expires_in: 300, matched_personas: ['STUDENT', 'VISITOR'] },
                }),
            }))
            storePending({ state: 'st-ok', personaCode: 'STUDENT' })
            setUrl('/?code=c&state=st-ok')
            beginUaePassCallback(import.meta.env)

            expect(JSON.parse(global.fetch.mock.calls[0][1].body)).toEqual({
                code: 'c',
                redirect_uri: `${window.location.origin}/`,
                personaCode: 'STUDENT',
            })
            expect((await takePendingUaePassSignIn()).matchedPersonas).toEqual(['STUDENT', 'VISITOR'])
        })

        it('rejects a valid code when the response has no access_token', async () => {
            global.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ data: {} }) }))
            storePending({ state: 'st-ok' })
            setUrl('/?code=c&state=st-ok')
            beginUaePassCallback(import.meta.env)

            await expect(takePendingUaePassSignIn()).rejects.toThrow(GENERIC)
        })

        it('maps a non-2xx exchange response to the generic message', async () => {
            global.fetch = vi.fn(async () => ({
                ok: false,
                status: 400,
                json: async () => ({ error: 'invalid_grant' }),
            }))
            storePending({ state: 'st-ok' })
            setUrl('/?code=c&state=st-ok')
            beginUaePassCallback(import.meta.env)

            await expect(takePendingUaePassSignIn()).rejects.toThrow(GENERIC)
        })

        it.each(['access_denied', 'cancelledOnApp', 'invalid_request', 'login_required'])(
            'maps the cancel error %s to the cancel message without calling the backend',
            async (error) => {
                storePending()
                setUrl(`/?error=${error}&state=st-1`)
                beginUaePassCallback(import.meta.env)

                await expect(takePendingUaePassSignIn()).rejects.toThrow(CANCEL)
                expect(global.fetch).not.toHaveBeenCalled()
            },
        )

        it('maps any other error to the generic message without calling the backend', async () => {
            storePending()
            setUrl('/?error=server_error&error_description=boom&state=st-1')
            beginUaePassCallback(import.meta.env)

            await expect(takePendingUaePassSignIn()).rejects.toThrow(GENERIC)
            expect(global.fetch).not.toHaveBeenCalled()
        })

        it('does not call the backend when the state is missing', async () => {
            storePending()
            setUrl('/?code=the-code')
            beginUaePassCallback(import.meta.env)

            await expect(takePendingUaePassSignIn()).rejects.toThrow(GENERIC)
            expect(global.fetch).not.toHaveBeenCalled()
        })

        it('does not call the backend when the state does not match', async () => {
            storePending({ state: 'expected' })
            setUrl('/?code=the-code&state=other')
            beginUaePassCallback(import.meta.env)

            await expect(takePendingUaePassSignIn()).rejects.toThrow(GENERIC)
            expect(global.fetch).not.toHaveBeenCalled()
        })

        it('does not call the backend when the pending state is older than 10 minutes', async () => {
            storePending({ state: 'st-old', startedAt: Date.now() - 11 * 60 * 1000 })
            setUrl('/?code=the-code&state=st-old')
            beginUaePassCallback(import.meta.env)

            await expect(takePendingUaePassSignIn()).rejects.toThrow(GENERIC)
            expect(global.fetch).not.toHaveBeenCalled()
        })

        it('makes no backend call and no result for a code with no pending sign-in', () => {
            setUrl('/?code=stray&state=whatever')
            beginUaePassCallback(import.meta.env)

            expect(global.fetch).not.toHaveBeenCalled()
            expect(takePendingUaePassSignIn()).toBeNull()
        })

        it('strips only the callback parameters and keeps the others', () => {
            storePending({ state: 'st-keep' })
            setUrl('/?persona=STUDENT&code=abc&state=st-keep&session_state=xyz')
            beginUaePassCallback(import.meta.env)

            expect(window.location.search).toBe('?persona=STUDENT')
            expect(window.location.pathname).toBe('/')
        })

        it('strips the error callback parameters and keeps the others', () => {
            storePending()
            setUrl('/?error=access_denied&error_description=nope&state=st-1&visitId=keep')
            beginUaePassCallback(import.meta.env)

            expect(window.location.search).toBe('?visitId=keep')
        })

        it('a valid callback clears a session stored earlier', () => {
            setTokens({ accessToken: 'old-token' })
            storePending({ state: 'st-new' })
            setUrl('/?code=c&state=st-new')
            beginUaePassCallback(import.meta.env)

            expect(getAccessToken()).toBe('')
        })

        it('is single-use: a second run with the same callback makes no backend call', async () => {
            storePending({ state: 'st-once' })
            setUrl('/?code=c&state=st-once')
            beginUaePassCallback(import.meta.env)
            await takePendingUaePassSignIn()

            setUrl('/?code=c&state=st-once')
            beginUaePassCallback(import.meta.env)
            expect(global.fetch).toHaveBeenCalledTimes(1)
            expect(takePendingUaePassSignIn()).toBeNull()
        })
    })

    describe('takePendingUaePassSignIn', () => {
        it('returns the pending promise once, then null', async () => {
            storePending({ state: 'st-take' })
            setUrl('/?code=c&state=st-take')
            beginUaePassCallback(import.meta.env)

            const first = takePendingUaePassSignIn()
            expect(first).toBeInstanceOf(Promise)
            expect(takePendingUaePassSignIn()).toBeNull()
            await first
        })
    })

    describe('completeUaePassSignIn', () => {
        it('sets student eligibility from a STUDENT persona_code claim before the student lookup', async () => {
            setStudentEligible(false)
            let eligibleAtLookup = null
            vi.mocked(tryResolveStudentIdForCurrentUser).mockImplementationOnce(async () => {
                eligibleAtLookup = getStudentEligible()
                return null
            })
            const accessToken = jwt({ persona_code: 'STUDENT' })
            await completeUaePassSignIn(import.meta.env, { accessToken, refreshToken: 'r', expiresIn: 60 })

            expect(eligibleAtLookup).toBe(true)
            expect(getStudentEligible()).toBe(true)
        })

        it('returns the completeSecureAuth result', async () => {
            const accessToken = jwt({ sub: 'x' })
            const result = await completeUaePassSignIn(import.meta.env, { accessToken, refreshToken: 'r', expiresIn: 60 })

            expect(result).toEqual({ accessToken, visitId: VISIT, studentId: null, availablePersonas: ['VISITOR'] })
        })

        it('clears student eligibility when the token has no persona_code', async () => {
            setStudentEligible(true)
            await completeUaePassSignIn(import.meta.env, { accessToken: jwt({ sub: 'x' }), refreshToken: null, expiresIn: null })

            expect(getStudentEligible()).toBe(false)
        })

        it('stores the token and marks the session as UAE PASS', async () => {
            await completeUaePassSignIn(import.meta.env, { accessToken: jwt({ sub: 'x' }), refreshToken: 'r', expiresIn: 60 })

            expect(getAccessToken()).not.toBe('')
            expect(wasUaePassSession()).toBe(true)
        })

        it('clearSecureAuthSession removes the UAE PASS marker', async () => {
            await completeUaePassSignIn(import.meta.env, { accessToken: jwt({ sub: 'x' }), refreshToken: null, expiresIn: null })
            expect(wasUaePassSession()).toBe(true)

            clearSecureAuthSession()
            expect(wasUaePassSession()).toBe(false)
            expect(localStorage.getItem('ankabut.chat.authMethod')).toBeNull()
        })
    })

    describe('endUaePassSession', () => {
        it('redirects to the UAE PASS logout with the encoded app root', () => {
            endUaePassSession()

            expect(assignSpy).toHaveBeenCalledWith(
                `https://stg-id.uaepass.ae/idshub/logout?redirect_uri=${encodeURIComponent(`${window.location.origin}/`)}`,
            )
        })
    })
})
