/**
 * @file Namespaced logging gated by `VITE_LOG_LEVEL`.
 * @module utils/logger
 */
const LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 }

const configured = (import.meta.env.VITE_LOG_LEVEL || '').toLowerCase()
const defaultLevel = import.meta.env.DEV ? 'debug' : 'info'
const activeLevel = LEVEL_RANK[configured] != null ? configured : defaultLevel

function enabled(level) {
    if (level === 'error') return true
    return LEVEL_RANK[level] >= LEVEL_RANK[activeLevel]
}

function emit(level, scope, message, ...args) {
    if (!enabled(level)) return
    const prefix = `[ankabut-chat:${scope}]`
    const fn = console[level] || console.log
    fn(prefix, message, ...args)
}

/**
 * @param {string} scope Short label (e.g. `api`, `ChatWindow`).
 * @returns {{ debug: Function, info: Function, warn: Function, error: Function }}
 */
export function createLogger(scope) {
    return {
        debug: (message, ...args) => emit('debug', scope, message, ...args),
        info: (message, ...args) => emit('info', scope, message, ...args),
        warn: (message, ...args) => emit('warn', scope, message, ...args),
        error: (message, ...args) => emit('error', scope, message, ...args),
    }
}
