/**
 * Namespaced console logging for the chat UI.
 *
 * Set VITE_LOG_LEVEL to one of: debug | info | warn | error
 * - Default in dev: debug
 * - Default in production build: info
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
 * @param {string} scope short label (e.g. 'api', 'ChatWindow')
 */
export function createLogger(scope) {
    return {
        debug: (message, ...args) => emit('debug', scope, message, ...args),
        info: (message, ...args) => emit('info', scope, message, ...args),
        warn: (message, ...args) => emit('warn', scope, message, ...args),
        error: (message, ...args) => emit('error', scope, message, ...args),
    }
}
