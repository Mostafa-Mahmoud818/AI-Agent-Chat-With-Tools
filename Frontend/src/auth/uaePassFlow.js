/**
 * @file Sign in with UAE PASS (staging): authorize redirect, callback handling, token exchange.
 * @module auth/uaePassFlow
 *
 * Flow: startUaePassSignIn() stores {state, redirectUri, startedAt, personaCode?} in sessionStorage and
 * redirects to UAE PASS. The app root receives ?code=…&state=… (or ?error=…). beginUaePassCallback() runs once
 * per page load before React: it strips the callback params from the URL, checks the state and starts
 * the code exchange against the modulith (which holds the client secret). The dialog takes the pending
 * result via takePendingUaePassSignIn() and finishes the sign-in with completeUaePassSignIn().
 *
 * Personas: a token without persona_code comes with matched_personas when the account has choices. The dialog
 * then shows a picker and restarts UAE PASS with the chosen personaCode (backend persona plan §5.5).
 *
 * Staging endpoints are used for every demo env. client_id must equal the backend's uaepass.client-id.
 */

import { resolveModulithRequestBase } from '../config/apiOrigin.js'
import { setStudentEligible } from '../config/chatContext.js'
import { createLogger } from '../utils/logger.js'
import { postJson } from './otpAccessTokenFlow.js'
import { readJwtPersonaCode } from './jwtClaims.js'
import {
    clearSecureAuthSession,
    completeSecureAuth,
    getAuthMethod,
    setAuthMethod,
} from './secureAuthSession.js'

const log = createLogger('uaePassFlow')

const AUTHORIZE_URL = 'https://stg-id.uaepass.ae/idshub/authorize'
const LOGOUT_URL = 'https://stg-id.uaepass.ae/idshub/logout'
const SCOPE = 'urn:uae:digitalid:profile:general'
const ACR_VALUES = 'urn:safelayer:tws:policies:authentication:level:low'
const PENDING_KEY = 'ankabut.chat.uaepass.pending'
const PENDING_TTL_MS = 10 * 60 * 1000
const CALLBACK_PARAMS = ['code', 'state', 'session_state', 'error', 'error_description']
/** Official cancel mapping (UAE PASS Error Messages): all four show the cancel text. */
const CANCEL_ERRORS = ['access_denied', 'cancelledOnApp', 'invalid_request', 'login_required']
const CANCEL_MESSAGE = 'User cancelled the login.'
const GENERIC_MESSAGE = 'Something went wrong during the login, please try again later!'

/** Pending result for the dialog: a promise of {accessToken, refreshToken, expiresIn, matchedPersonas}, or null. */
let pendingResult = null

function clientId() {
    return import.meta.env.VITE_UAEPASS_CLIENT_ID || 'sandbox_stage'
}

function appRoot() {
    return window.location.origin + import.meta.env.BASE_URL
}

function uiLocale() {
    return String(navigator.language || '').toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

/** 32 random bytes as base64url. */
function randomState() {
    const bytes = new Uint8Array(32)
    crypto.getRandomValues(bytes)
    let binary = ''
    for (const b of bytes) binary += String.fromCharCode(b)
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function rejectedWith(message) {
    const promise = Promise.reject(new Error(message))
    promise.catch(() => {})
    return promise
}

/** Reads and removes the pending sign-in record (null when absent or unreadable). */
function readPending() {
    try {
        const raw = sessionStorage.getItem(PENDING_KEY)
        sessionStorage.removeItem(PENDING_KEY)
        if (!raw) return null
        const parsed = JSON.parse(raw)
        if (typeof parsed?.state !== 'string' || typeof parsed?.redirectUri !== 'string') return null
        return { ...parsed, startedAt: Number(parsed.startedAt) || 0 }
    } catch {
        return null
    }
}

/**
 * Removes the callback parameters from the query string and keeps everything else byte-for-byte.
 *
 * @returns {void}
 */
function stripCallbackParams() {
    const kept = window.location.search
        .slice(1)
        .split('&')
        .filter((part) => {
            if (!part) return false
            const rawName = part.split('=')[0]
            let name = rawName
            try {
                name = decodeURIComponent(rawName)
            } catch {
                // keep the raw name
            }
            return !CALLBACK_PARAMS.includes(name)
        })
    const search = kept.length ? `?${kept.join('&')}` : ''
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${search}${window.location.hash}`)
}

/**
 * Exchanges the code at the modulith. Every failure becomes the generic user message.
 *
 * @param {ImportMetaEnv} env
 * @param {string} code
 * @param {string} redirectUri the exact redirect_uri sent to UAE PASS
 * @param {string|undefined} personaCode persona chosen before the redirect, sent only when set
 * @returns {Promise<{accessToken: string, refreshToken: string|null, expiresIn: number|null, matchedPersonas: string[]}>}
 */
function exchangeCode(env, code, redirectUri, personaCode) {
    const url = `${resolveModulithRequestBase(env)}/api/v1/public/identity/auth/uaepass/token`
    const body = personaCode ? { code, redirect_uri: redirectUri, personaCode } : { code, redirect_uri: redirectUri }
    return postJson(url, body)
        .then((json) => {
            const data = json?.data
            const accessToken = String(data?.access_token ?? '').trim()
            if (!accessToken) throw new Error('No access_token in response')
            return {
                accessToken,
                refreshToken: data?.refresh_token ?? null,
                expiresIn: data?.expires_in ?? null,
                // Present only when the token has no persona_code and the account has choices.
                matchedPersonas: Array.isArray(data?.matched_personas) ? data.matched_personas : [],
            }
        })
        .catch((err) => {
            log.error('UAE PASS token exchange failed', { status: err?.status, error: err?.error, message: err?.message })
            throw new Error(GENERIC_MESSAGE)
        })
}

/**
 * Saves the pending state and redirects the browser to the UAE PASS authorize endpoint.
 *
 * @param {string} [personaCode] persona to sign in as, sent with the code exchange after the redirect
 * @returns {void}
 */
export function startUaePassSignIn(personaCode) {
    const state = randomState()
    const redirectUri = appRoot()
    const pending = { state, redirectUri, startedAt: Date.now() }
    if (personaCode) pending.personaCode = personaCode
    try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending))
    } catch (err) {
        log.error('Cannot store UAE PASS state; sign-in not started', err)
        return
    }
    const params = new URLSearchParams({
        response_type: 'code',
        client_id: clientId(),
        redirect_uri: redirectUri,
        scope: SCOPE,
        state,
        acr_values: ACR_VALUES,
        ui_locales: uiLocale(),
    })
    window.location.assign(`${AUTHORIZE_URL}?${params.toString()}`)
}

/**
 * Handles a UAE PASS callback on page load. Synchronous and never throws. Starts the code exchange
 * without awaiting it; the result is kept for takePendingUaePassSignIn().
 *
 * @param {ImportMetaEnv} env
 * @returns {void}
 */
export function beginUaePassCallback(env) {
    pendingResult = null
    try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')
        const error = params.get('error')
        if (code === null && error === null) return

        const state = params.get('state')
        stripCallbackParams()
        const pending = readPending()
        if (!pending) return

        if (error !== null) {
            log.warn('UAE PASS returned an error', { error, error_description: params.get('error_description') })
            pendingResult = rejectedWith(CANCEL_ERRORS.includes(error) ? CANCEL_MESSAGE : GENERIC_MESSAGE)
            return
        }

        const expired = Date.now() - pending.startedAt > PENDING_TTL_MS
        if (expired || pending.state !== state) {
            log.warn('UAE PASS callback rejected: state missing, expired or mismatched', { expired })
            pendingResult = rejectedWith(GENERIC_MESSAGE)
            return
        }

        // A newer sign-in wins over any session stored earlier.
        clearSecureAuthSession()
        const personaCode = typeof pending.personaCode === 'string' && pending.personaCode ? pending.personaCode : undefined
        pendingResult = exchangeCode(env, code, pending.redirectUri, personaCode)
        pendingResult.catch(() => {})
    } catch (err) {
        log.error('UAE PASS callback handling failed', err)
    }
}

/**
 * Returns the pending UAE PASS sign-in once, then null (React StrictMode re-runs mount effects).
 *
 * @returns {Promise<{accessToken: string, refreshToken: string|null, expiresIn: number|null, matchedPersonas: string[]}>|null}
 */
export function takePendingUaePassSignIn() {
    const result = pendingResult
    pendingResult = null
    return result
}

/**
 * Stores the UAE PASS token through the same path as OTP and returns the same outcome shape.
 *
 * @param {ImportMetaEnv} env
 * @param {{accessToken: string, refreshToken: string|null, expiresIn: number|null}} tokens
 * @returns {Promise<object>}
 */
export async function completeUaePassSignIn(env, tokens) {
    // UAE PASS never calls check-eligibility, so student eligibility comes from the token claim.
    setStudentEligible(readJwtPersonaCode(tokens.accessToken) === 'STUDENT')
    setAuthMethod('UAEPASS')
    return completeSecureAuth(env, tokens.accessToken, {
        refreshToken: tokens.refreshToken,
        expiresIn: tokens.expiresIn,
    })
}

/**
 * @returns {boolean} true when the stored session was started with UAE PASS
 */
export function wasUaePassSession() {
    return getAuthMethod() === 'UAEPASS'
}

/**
 * Redirects to the UAE PASS logout so the next sign-in does not reuse the UAE PASS browser session.
 *
 * @returns {void}
 */
export function endUaePassSession() {
    window.location.assign(`${LOGOUT_URL}?redirect_uri=${encodeURIComponent(appRoot())}`)
}
