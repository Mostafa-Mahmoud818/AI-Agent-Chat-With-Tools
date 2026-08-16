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

    it('appends languageHint as a query param when provided', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { text: 'مرحبا', language: 'ar' } }),
        })

        const { transcribeSpeech } = await import('../api.js')
        const blob = new Blob(['audio-bytes'], { type: 'audio/webm' })
        await transcribeSpeech(blob, { languageHint: 'ar' })

        const [url] = fetch.mock.calls[0]
        expect(url).toContain('languageHint=ar')
    })

    it('rejects an oversize recording before calling fetch', async () => {
        const { transcribeSpeech } = await import('../api.js')
        const { AUDIO_MAX_BYTES } = await import('../../config/chattingValidationLimits.js')
        const oversize = { size: AUDIO_MAX_BYTES + 1, type: 'audio/webm' }

        await expect(transcribeSpeech(oversize)).rejects.toMatchObject({ errorCode: 'audio_too_large' })
        expect(fetch).not.toHaveBeenCalled()
    })
})

describe('startOrchestration', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('fetch', vi.fn())
        localStorage.clear()
        const { setAccessToken } = await import('../../auth/tokenStore.js')
        setAccessToken('test-token')
    })

    it('posts VISIT chatContext with canonical contextData.id', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { processInstanceKey: '1' } }),
        })

        const { startOrchestration } = await import('../api.js')
        const visitId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        await startOrchestration('conv-1', 'Hello', {
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: { id: visitId },
        })

        const [, options] = fetch.mock.calls[0]
        const body = JSON.parse(options.body)
        expect(body.chatContext).toEqual({
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: { id: visitId },
        })
        expect(body.chatContext.contextData).not.toHaveProperty('visitId')
    })

    it('rejects a legacy visitId alias without sending', async () => {
        const { startOrchestration } = await import('../api.js')
        await expect(startOrchestration('conv-1', 'Hello', {
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: { visitId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' },
        })).rejects.toMatchObject({ errorCode: 'invalid_chat_context' })
        expect(fetch).not.toHaveBeenCalled()
    })
})
