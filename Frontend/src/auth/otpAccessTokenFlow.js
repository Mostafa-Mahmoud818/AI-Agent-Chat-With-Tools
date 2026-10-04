/**
 * @file Email + OTP token acquisition for DEV, TEST, and LOCAL modulith presets.
 * @module auth/otpAccessTokenFlow
 *
 * LOCAL: provision (internal) → check-eligibility → otp/email/token → completeSecureAuth.
 * DEV/TEST: check-eligibility → otp/email/token → completeSecureAuth (public endpoints only).
 *
 * OTP verify accepts optional {@code personaCode} (backend {@code OtpEmailVerifyRequest}).
 * Required when check-eligibility returned 2+ personas; omitted for identity-only (empty set)
 * and optional when exactly one matched (backend auto-resolves).
 */

import { resolveActiveBackendPreset, resolveModulithRequestBase } from '../config/apiOrigin.js'
import { normalizeEligiblePersonas } from '../config/personaSession.js'
import { createLogger } from '../utils/logger.js'
import { completeSecureAuth } from './secureAuthSession.js'
import { persistStudentEligibility } from './studentResolution.js'

const log = createLogger('otpAccessTokenFlow')

/** OAuth2 {@code error} when 2+ personas matched and {@code personaCode} was omitted. */
export const PERSONA_SELECTION_REQUIRED = 'persona_selection_required'
/** OAuth2 {@code error} when the requested persona is not in the challenge's eligible set. */
export const PERSONA_NOT_ELIGIBLE = 'persona_not_eligible'

/**
 * Typed failure from check-eligibility or OTP token exchange.
 * {@code error} is the OAuth2 {@code error} value or an {@code ApiResponse.errors[0].code}.
 */
export class OtpAuthError extends Error {
    /**
     * @param {string} message
     * @param {{ error?: string|null, status?: number }} [details]
     */
    constructor(message, { error = null, status = 0 } = {}) {
        super(message)
        this.name = 'OtpAuthError'
        this.error = error
        this.status = status
    }
}

/**
 * @param {Response} res
 * @param {Record<string, unknown>|null} json
 * @returns {OtpAuthError}
 */
function errorFromResponse(res, json) {
    const oauthError = typeof json?.error === 'string' ? json.error : null
    const apiCode = json?.errors?.[0]?.code
    const msg =
        json?.error_description ||
        json?.message ||
        json?.errors?.[0]?.message ||
        oauthError ||
        `HTTP ${res.status}`
    return new OtpAuthError(String(msg), {
        error: oauthError || (typeof apiCode === 'string' ? apiCode : null),
        status: res.status,
    })
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
        throw errorFromResponse(res, json)
    }
    return json
}

/**
 * Trigger OTP send: LOCAL provisions first, then all presets call check-eligibility.
 *
 * @param {Record<string, unknown>} env
 * @param {string} email
 * @returns {Promise<{ eligible: boolean, personas: string[], reasons: unknown[] }>}
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
    const data = eligibility?.data
    if (data?.eligible === false) {
        persistStudentEligibility(null)
        throw new Error('No account found for this email.')
    }
    persistStudentEligibility(data)

    const personas = normalizeEligiblePersonas(data?.personas)
    log.info('OTP challenge prepared', { email: normalizedEmail, preset, personas })
    return {
        eligible: true,
        personas,
        reasons: Array.isArray(data?.reasons) ? data.reasons : [],
    }
}

/**
 * Exchange OTP for access token, store it, resolve visit and/or student ids.
 *
 * @param {Record<string, unknown>} env
 * @param {string} email
 * @param {string} code
 * @param {string|null|undefined} [personaCode] identity {@code persona_code} selected at verify time
 * @returns {Promise<{ accessToken: string, visitId: string|null, studentId: string|null, availablePersonas: Array<'VISIT'|'STUDENT'> }>}
 */
export async function exchangeOtpForToken(env, email, code, personaCode) {
    const normalizedEmail = String(email ?? '').trim()
    const normalizedCode = String(code ?? '').trim()
    if (!normalizedEmail) throw new Error('Email is required')
    if (!normalizedCode) throw new Error('OTP code is required')

    const body = { email: normalizedEmail, code: normalizedCode }
    const normalizedPersona = String(personaCode ?? '').trim()
    if (normalizedPersona) {
        body.personaCode = normalizedPersona
    }

    const base = resolveModulithRequestBase(env)
    const tokenResponse = await postJson(
        `${base}/api/v1/public/identity/auth/otp/email/token`,
        body,
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
    log.info('Access token acquired via OTP', {
        hasRefreshToken: Boolean(refreshToken),
        personaCode: normalizedPersona || null,
    })
    return completeSecureAuth(env, String(token).trim(), { refreshToken, expiresIn })
}
