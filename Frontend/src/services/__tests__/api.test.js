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

    it('uses a 35s timeout on /start (above servlet-bound correlate)', async () => {
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { processInstanceKey: '1' } }),
        })

        const { startOrchestration, ORCHESTRATION_POST_TIMEOUT_MS } = await import('../api.js')
        const visitId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
        await startOrchestration('conv-1', 'Hello', {
            schemaVersion: '1.0',
            contextType: 'VISIT',
            contextData: { id: visitId },
        })

        expect(ORCHESTRATION_POST_TIMEOUT_MS).toBe(35_000)
        expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === ORCHESTRATION_POST_TIMEOUT_MS)).toBe(true)
        setTimeoutSpy.mockRestore()
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

    it('posts STUDENT chatContext with Identity user UUID', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => ({ success: true, data: { processInstanceKey: '2' } }),
        })

        const { startOrchestration } = await import('../api.js')
        const studentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
        await startOrchestration('conv-2', 'I need an absence', {
            schemaVersion: '1.0',
            contextType: 'STUDENT',
            contextData: { id: studentId },
        })

        const [, options] = fetch.mock.calls[0]
        const body = JSON.parse(options.body)
        expect(body.chatContext).toEqual({
            schemaVersion: '1.0',
            contextType: 'STUDENT',
            contextData: { id: studentId },
        })
    })
})

describe('uploadAbsenceChatAttachment', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('fetch', vi.fn())
        localStorage.clear()
        const { setAccessToken } = await import('../../auth/tokenStore.js')
        setAccessToken('test-token')
    })

    it('posts multipart file to absence attachments endpoint', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                success: true,
                data: {
                    originalFileName: 'note.pdf',
                    contentType: 'application/pdf',
                    sizeBytes: 42,
                    chatFollowUpMessage: '[attachment] path=banner/uuid_note.pdf filename=note.pdf type=application/pdf',
                },
            }),
        })

        const { uploadAbsenceChatAttachment } = await import('../api.js')
        const file = new File(['pdf'], 'note.pdf', { type: 'application/pdf' })
        const result = await uploadAbsenceChatAttachment(file)

        expect(result.chatFollowUpMessage).toContain('[attachment]')
        const [url, options] = fetch.mock.calls[0]
        expect(url).toContain('/api/v1/secure/students/absence-requests/attachments')
        expect(options.method).toBe('POST')
        expect(options.headers.Authorization).toBe('Bearer test-token')
        expect(options.headers['Content-Type']).toBeUndefined()
        expect(options.body).toBeInstanceOf(FormData)
    })
})

describe('uploadErrorBannerChatAttachment', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('fetch', vi.fn())
        localStorage.clear()
        const { setAccessToken } = await import('../../auth/tokenStore.js')
        setAccessToken('test-token')
    })

    it('posts multipart file to errorbanner attachments endpoint', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 201,
            json: async () => ({
                success: true,
                data: {
                    originalFileName: 'shot.png',
                    contentType: 'image/png',
                    sizeBytes: 12,
                    chatFollowUpMessage: '[attachment] path=banner/uuid_shot.png filename=shot.png type=image/png',
                },
            }),
        })

        const { uploadErrorBannerChatAttachment } = await import('../api.js')
        const file = new File(['png'], 'shot.png', { type: 'image/png' })
        const result = await uploadErrorBannerChatAttachment(file)

        expect(result.chatFollowUpMessage).toContain('[attachment]')
        const [url] = fetch.mock.calls[0]
        expect(url).toContain('/api/v1/secure/errorbanner/attachments')
    })
})

describe('sendReply', () => {
    beforeEach(async () => {
        vi.resetModules()
        vi.stubGlobal('fetch', vi.fn())
        localStorage.clear()
        const { setAccessToken } = await import('../../auth/tokenStore.js')
        setAccessToken('test-token')
    })

    it('uses a 35s timeout on /user-messages', async () => {
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout')
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 202,
            json: async () => ({ success: true, data: null }),
        })

        const { sendReply, ORCHESTRATION_POST_TIMEOUT_MS } = await import('../api.js')
        await sendReply('conv-1', 'More')

        expect(ORCHESTRATION_POST_TIMEOUT_MS).toBe(35_000)
        const [url] = fetch.mock.calls[0]
        expect(url).toContain('/user-messages')
        expect(setTimeoutSpy.mock.calls.some(([, ms]) => ms === ORCHESTRATION_POST_TIMEOUT_MS)).toBe(true)
        setTimeoutSpy.mockRestore()
    })
})
