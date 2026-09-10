/**
 * @file Email + OTP token acquisition for DEV, TEST, and LOCAL modulith presets.
 * @module auth/otpAccessTokenFlow
 *
 * LOCAL: provision (internal) → check-eligibility → otp/email/token → completeSecureAuth.
 * DEV/TEST: check-eligibility → otp/email/token → completeSecureAuth (public endpoints only).
 */

import { resolveActiveBackendPreset, resolveModulithRequestBase } from '../config/apiOrigin.js'
import { createLogger } from '../utils/logger.js'
import { completeSecureAuth } from './secureAuthSession.js'
import { persistStudentEligibility } from './studentResolution.js'

const log = createLogger('otpAccessTokenFlow')

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
        const msg =
            json?.message ||
            json?.error_description ||
            json?.error ||
            `HTTP ${res.status}`
        throw new Error(msg)
    }
    return json
}

/**
 * Trigger OTP send: LOCAL provisions first, then all presets call check-eligibility.
 *
 * @param {Record<string, unknown>} env
 * @param {string} email
 * @returns {Promise<void>}
 */
export async function prepareOtpChallenge(env, email) {
    const normalizedEmail = String(email ?? '').trim()
    if (!normalizedEmail) throw new Error('Email is required')

    const preset = resolveActiveBackendPreset(env)
    const base = resolveModulithRequestBase(env)

    if (preset === 'local') {
        await postJson(`${base}/v1/internal/identity/email/provision`, { email: normalizedEmail })
    }

    const eligibility = await postJson(
        `${base}/api/v1/public/visitor-management/check-eligibility`,
        { email: normalizedEmail },
    )
    if (eligibility?.data?.eligible === false) {
        persistStudentEligibility(null)
        throw new Error('No account found for this email.')
    }
    persistStudentEligibility(eligibility?.data)

    log.info('OTP challenge prepared', { email: normalizedEmail, preset })
}

/**
 * Step 3: exchange OTP for access token, store it, resolve visit and/or student ids.
 *
 * @param {Record<string, unknown>} env
 * @param {string} email
 * @param {string} code
 * @returns {Promise<{ accessToken: string, visitId: string|null, studentId: string|null, availablePersonas: Array<'VISIT'|'STUDENT'> }>}
 */
export async function exchangeOtpForToken(env, email, code) {
    const normalizedEmail = String(email ?? '').trim()
    const normalizedCode = String(code ?? '').trim()
    if (!normalizedEmail) throw new Error('Email is required')
    if (!normalizedCode) throw new Error('OTP code is required')

    const base = resolveModulithRequestBase(env)
    const tokenResponse = await postJson(
        `${base}/api/v1/public/identity/auth/otp/email/token`,
        { email: normalizedEmail, code: normalizedCode },
    )
    const token = tokenResponse?.data?.access_token
    if (!token || !String(token).trim()) {
        throw new Error('No access_token in response')
    }
    // refresh_token / expires_in: present on the real backend (OAuth2TokenResponse) but optional
    // here defensively — an OTP exchange without them still signs the user in, just without the
    // ability to silently refresh later (falls back to a fresh OTP challenge when the access token expires).
    const refreshToken = tokenResponse?.data?.refresh_token
    const expiresIn = tokenResponse?.data?.expires_in
    log.info('Access token acquired via OTP', { hasRefreshToken: Boolean(refreshToken) })
    return completeSecureAuth(env, String(token).trim(), { refreshToken, expiresIn })
}
