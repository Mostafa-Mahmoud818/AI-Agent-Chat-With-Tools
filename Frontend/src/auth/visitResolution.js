/**
 * @file Resolves {@code visitId} for the authenticated user using existing modulith APIs only.
 * @module auth/visitResolution
 *
 * Uses {@code GET /api/v1/secure/visitor-management/my-visits*} (DB-backed views).
 * {@code GET .../my-visits} (no period) also triggers the server's on-demand visit sync from ACL.
 */

import { resolveApiOrigin } from '../config/apiOrigin.js'
import {
    isPlaceholderVisitId,
    normalizeVisitId,
    setRuntimeVisitId,
} from '../config/chatContext.js'
import { createLogger } from '../utils/logger.js'

const log = createLogger('visitResolution')

/** Order: all (sync + list) → upcoming → past */
const MY_VISITS_LIST_PATHS = [
    { path: '/api/v1/secure/visitor-management/my-visits?page=0&size=5', label: 'all' },
    { path: '/api/v1/secure/visitor-management/my-visits/upcoming?page=0&size=5', label: 'upcoming' },
    { path: '/api/v1/secure/visitor-management/my-visits/past?page=0&size=5', label: 'past' },
]

/**
 * @param {string} accessToken
 * @returns {Record<string, string>}
 */
function authHeaders(accessToken) {
    return { Authorization: `Bearer ${String(accessToken).trim()}` }
}

/**
 * @param {unknown} data ApiResponse.data — PagedResponse or single UserVisitDto
 * @returns {string|null}
 */
function visitIdFromPagedData(data) {
    if (data == null || typeof data !== 'object') return null
    const content = data.content
    if (Array.isArray(content)) {
        for (const row of content) {
            const id = normalizeVisitId(row?.visitId)
            if (id && !isPlaceholderVisitId(id)) return id
        }
    }
    const direct = normalizeVisitId(data.visitId)
    if (direct && !isPlaceholderVisitId(direct)) return direct
    return null
}

/**
 * @param {string} origin
 * @param {string} accessToken
 * @returns {Promise<{ visitId: string, source: string }|null>}
 */
async function fetchVisitIdFromMyVisitsLists(origin, accessToken) {
    for (const { path, label } of MY_VISITS_LIST_PATHS) {
        try {
            const res = await fetch(`${origin}${path}`, { headers: authHeaders(accessToken) })
            if (!res.ok) {
                log.debug('my-visits list empty or error', { path, status: res.status })
                continue
            }
            const json = await res.json()
            const id = visitIdFromPagedData(json?.data)
            if (id) {
                log.info('Resolved visitId from my-visits', { source: label, visitId: id, path })
                return { visitId: id, source: label }
            }
        } catch (err) {
            log.warn('my-visits list lookup error', { path, err })
        }
    }
    return null
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Loads the current user's visit id from existing secure my-visits endpoints and persists it
 * for orchestration {@code chatContext}. Retries while post-login async sync may still populate DB.
 *
 * @param {ImportMetaEnv} [env]
 * @param {string} accessToken Bearer JWT
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 * @returns {Promise<string>} normalized visit UUID
 */
export async function resolveVisitIdForCurrentUser(env = import.meta.env, accessToken, opts = {}) {
    const { attempts = 10, delayMs = 1500 } = opts
    const token = String(accessToken ?? '').trim()
    if (!token) {
        throw new Error('Bearer token is required to resolve visit id')
    }

    const origin = resolveApiOrigin(env)
    let lastError = null

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const resolved = await fetchVisitIdFromMyVisitsLists(origin, token)
            if (resolved) {
                setRuntimeVisitId(resolved.visitId)
                return resolved.visitId
            }
        } catch (err) {
            lastError = err
            log.warn('visit resolution attempt failed', { attempt, err })
        }
        if (attempt < attempts) {
            await sleep(delayMs)
        }
    }

    const message =
        'No visit found for your account yet. After OTP login, wait a few seconds and try again, or confirm eligibility returned visits.'
    if (lastError instanceof Error) {
        throw new Error(`${message} (${lastError.message})`)
    }
    throw new Error(message)
}

/**
 * @param {ImportMetaEnv} [env]
 * @param {string} accessToken
 * @param {{ attempts?: number, delayMs?: number }} [opts]
 * @returns {Promise<string|null>}
 */
export async function tryResolveVisitIdForCurrentUser(env, accessToken, opts = {}) {
    try {
        return await resolveVisitIdForCurrentUser(env, accessToken, opts)
    } catch (err) {
        log.warn('Could not resolve visit id', err)
        return null
    }
}
