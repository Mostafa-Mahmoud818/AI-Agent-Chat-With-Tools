/**
 * @file Local OTP-based token acquisition flow for dev (`VITE_API_BACKEND=local`).
 * @module auth/localAccessTokenFlow
 */

import { resolveApiOrigin } from '../config/apiOrigin.js'
import { createLogger } from '../utils/logger.js'
import { setAccessToken } from './tokenStore.js'

const log = createLogger('localAccessTokenFlow')

function isLocalBackend(env) {
    const origin = resolveApiOrigin(env)
    return origin === 'http://localhost:8085'
}

async function postJson(url, body) {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    })
    let json = null
    try {
        json = await res.json()
    } catch {
        json = null
    }
    if (!res.ok) {
        const msg = json?.message || `HTTP ${res.status}`
        throw new Error(msg)
    }
    return json
}

export function shouldUseLocalOtpFlow(env) {
    return import.meta.env.MODE !== 'test' && isLocalBackend(env)
}

/**
 * Step 1+2: provision + eligibility check to trigger OTP send.
 *
 * @param {Record<string, unknown>} env
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function prepareLocalOtpChallenge(env, email) {
    const normalizedEmail = String(email ?? '').trim()
    if (!normalizedEmail) throw new Error('Email is required')
    const origin = resolveApiOrigin(env)
    await postJson(`${origin}/v1/internal/identity/email/provision`, { email: normalizedEmail })
    await postJson(`${origin}/api/v1/public/visitor-management/check-eligibility`, { email: normalizedEmail })
    log.info('Local OTP challenge prepared', { email: normalizedEmail })
}

/**
 * Step 3: exchange OTP code for access token and store it.
 *
 * @param {Record<string, unknown>} env
 * @param {string} email
 * @param {string} code
 * @returns {Promise<string>} access token
 */
export async function exchangeLocalOtpForToken(env, email, code) {
    const normalizedEmail = String(email ?? '').trim()
    const normalizedCode = String(code ?? '').trim()
    if (!normalizedEmail) throw new Error('Email is required')
    if (!normalizedCode) throw new Error('OTP code is required')

    const origin = resolveApiOrigin(env)
    const tokenResponse = await postJson(
        `${origin}/api/v1/public/identity/auth/otp/email/token`,
        { email: normalizedEmail, code: normalizedCode },
    )
    const token = tokenResponse?.data?.access_token
    if (!token || !String(token).trim()) {
        throw new Error('No access_token in response')
    }
    const finalToken = String(token).trim()
    setAccessToken(finalToken)
    log.info('Local access token acquired and stored')
    return finalToken
}
