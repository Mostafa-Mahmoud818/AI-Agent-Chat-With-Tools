import { describe, it, expect, beforeEach, vi } from 'vitest'

describe('transcribeSpeech', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('fetch', vi.fn())
        localStorage.clear()
        const { setAccessToken } = await import('../../auth/tokenStore.js')
        setAccessToken('test-token')
    })

    it('posts multipart audio to secure speech endpoint with bearer auth', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { text: 'Show my visits', language: null } }),
        })

        const { transcribeSpeech } = await import('../api.js')
        const blob = new Blob(['audio-bytes'], { type: 'audio/webm' })
        const result = await transcribeSpeech(blob)

        expect(result.text).toBe('Show my visits')
        expect(fetch).toHaveBeenCalledTimes(1)
        const [url, options] = fetch.mock.calls[0]
        expect(url).toContain('/api/v1/secure/speech/transcriptions')
        expect(options.method).toBe('POST')
        expect(options.headers.Authorization).toBe('Bearer test-token')
        expect(options.headers['Content-Type']).toBeUndefined()
        expect(options.body).toBeInstanceOf(FormData)
    })
})
