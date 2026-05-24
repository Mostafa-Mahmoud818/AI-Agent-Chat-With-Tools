import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveVisitIdForCurrentUser } from '../visitResolution.js'
import { STORAGE_KEY } from '../../config/chatContext.js'

describe('visitResolution', () => {
    beforeEach(() => {
        localStorage.clear()
        vi.stubGlobal('fetch', vi.fn())
    })

    it('resolves visitId from my-visits upcoming list', async () => {
        const visitId = 'd98cef26-a6fe-4b40-9091-c7dc191751a8'
        fetch
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({ success: true, data: { content: [], totalElements: 0 } }),
            })
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                json: async () => ({
                    success: true,
                    data: {
                        content: [{ visitId, visitTitle: 'Test visit' }],
                        totalElements: 1,
                    },
                }),
            })

        const resolved = await resolveVisitIdForCurrentUser(
            { VITE_API_BACKEND: 'local' },
            'fake-token',
            { attempts: 1 },
        )

        expect(resolved).toBe(visitId)
        expect(localStorage.getItem(STORAGE_KEY)).toBe(visitId)
        expect(fetch).toHaveBeenCalledWith(
            expect.stringContaining('/my-visits/upcoming'),
            expect.any(Object),
        )
    })
})
