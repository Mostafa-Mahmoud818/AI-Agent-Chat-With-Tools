import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Helpers to drive createFetchEventSource / createResponseStream via mocked fetch bodies.
 */
function sseBodyFromChunks(chunks) {
    const encoder = new TextEncoder()
    let i = 0
    return {
        getReader() {
            return {
                async read() {
                    if (i >= chunks.length) return { done: true, value: undefined }
                    const value = typeof chunks[i] === 'string' ? encoder.encode(chunks[i]) : chunks[i]
                    i += 1
                    return { done: false, value }
                },
            }
        },
    }
}

describe('createResponseStream framing', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('fetch', vi.fn())
        localStorage.clear()
        const { setAccessToken } = await import('../../auth/tokenStore.js')
        setAccessToken('test-token')
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('reassembles chunk-split frames and flushes trailing unterminated data', async () => {
        const ready = JSON.stringify({ status: 'ready', message: '{"replyType":"text","textString":"Hi"}', handledBy: 'FRONT_DOOR' })
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: sseBodyFromChunks([
                `data: ${ready.slice(0, 20)}`,
                `${ready.slice(20)}`,
            ]),
        })

        const { createResponseStream } = await import('../../services/api.js')
        const es = createResponseStream('conv-1')
        const messages = []
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), 2000)
            es.onmessage = (ev) => {
                messages.push(ev.data)
            }
            es.onclosedWithoutTerminal = () => {
                clearTimeout(t)
                resolve()
            }
            // Also resolve when stream settles after terminal
            const check = setInterval(() => {
                if (es.readyState === 2 && messages.length > 0) {
                    clearInterval(check)
                    clearTimeout(t)
                    resolve()
                }
            }, 10)
        })

        expect(messages).toHaveLength(1)
        expect(JSON.parse(messages[0]).status).toBe('ready')
    })

    it('invokes onclosedWithoutTerminal when body ends with no terminal', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: sseBodyFromChunks([
                `data: ${JSON.stringify({ status: 'processing' })}\n\n`,
            ]),
        })

        const { createResponseStream } = await import('../../services/api.js')
        const es = createResponseStream('conv-2')
        const closed = await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), 2000)
            es.onclosedWithoutTerminal = () => {
                clearTimeout(t)
                resolve(true)
            }
            es.onerror = () => {
                clearTimeout(t)
                reject(new Error('unexpected error'))
            }
        })
        expect(closed).toBe(true)
    })

    it('does not invoke onclosedWithoutTerminal after a ready terminal', async () => {
        const ready = JSON.stringify({ status: 'ready', message: 'ok', handledBy: null })
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            body: sseBodyFromChunks([`data: ${ready}\n\n`]),
        })

        const { createResponseStream } = await import('../../services/api.js')
        const es = createResponseStream('conv-3')
        let closedWithout = false
        await new Promise((resolve, reject) => {
            const t = setTimeout(() => reject(new Error('timeout')), 2000)
            es.onmessage = () => {}
            es.onclosedWithoutTerminal = () => {
                closedWithout = true
            }
            const check = setInterval(() => {
                if (es.readyState === 2) {
                    clearInterval(check)
                    clearTimeout(t)
                    resolve()
                }
            }, 10)
        })
        expect(closedWithout).toBe(false)
    })
})
