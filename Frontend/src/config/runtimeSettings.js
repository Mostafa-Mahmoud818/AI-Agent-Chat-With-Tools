/**
 * @file Runtime overrides chosen via the UI (env picker).
 * Persisted in localStorage so the developer/tester does not need to edit `.env` to switch targets.
 * These overrides win over `import.meta.env` when present.
 *
 * Visit id for orchestration `chatContext` lives in {@link ./chatContext.js}.
 *
 * @module config/runtimeSettings
 */

const KEY_BACKEND_ENV = 'ankabut.chat.backendEnv'

/** Maps UI labels to the `VITE_API_BACKEND` preset keys used by {@link resolveApiOrigin}. */
export const BACKEND_PRESETS = {
    DEV: 'remote-dev',
    TEST: 'remote-test',
    STAGE: 'remote-stage',
    LOCAL: 'local',
}

/** Reverse lookup: preset key → UI label. */
export const PRESET_TO_LABEL = {
    'remote-dev': 'DEV',
    'remote-test': 'TEST',
    'remote-stage': 'STAGE',
    local: 'LOCAL',
}

function safeGet(key) {
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSet(key, value) {
    try {
        if (value == null || value === '') {
            localStorage.removeItem(key)
        } else {
            localStorage.setItem(key, value)
        }
    } catch {
        // ignore — private mode / quota / disabled storage
    }
}

/**
 * @returns {'DEV'|'TEST'|'STAGE'|'LOCAL'|null} the runtime-selected backend env, or null if none chosen yet.
 */
export function getRuntimeBackendEnv() {
    const raw = safeGet(KEY_BACKEND_ENV)
    if (raw === 'DEV' || raw === 'TEST' || raw === 'STAGE' || raw === 'LOCAL') return raw
    return null
}

/**
 * @param {'DEV'|'TEST'|'STAGE'|'LOCAL'|null} label
 */
export function setRuntimeBackendEnv(label) {
    if (label == null) {
        safeSet(KEY_BACKEND_ENV, null)
        return
    }
    if (!Object.hasOwn(BACKEND_PRESETS, label)) return
    safeSet(KEY_BACKEND_ENV, label)
}

/**
 * @returns {string} resolved preset key (`remote-dev` etc) for the runtime override,
 * or empty string if no runtime override is set.
 */
export function getRuntimeBackendPreset() {
    const label = getRuntimeBackendEnv()
    return label ? BACKEND_PRESETS[label] : ''
}
