import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { transcribeSpeech } from '../../services/api.js'
import ChatInput from '../chat/ChatInput'

vi.mock('../../services/api.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        transcribeSpeech: vi.fn(),
    }
})

class MockMediaRecorder {
    static isTypeSupported = vi.fn(() => true)

    constructor(_stream, _opts) {
        this.state = 'inactive'
        this.ondataavailable = null
        this.onstop = null
        this.onerror = null
    }

    start() {
        this.state = 'recording'
        this.ondataavailable?.({ data: new Blob(['audio-chunk'], { type: 'audio/webm' }) })
    }

    stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob(['audio-chunk'], { type: 'audio/webm' }) })
        this.onstop?.()
    }
}

describe('ChatInput', () => {
    beforeEach(() => {
        vi.mocked(transcribeSpeech).mockReset()
        vi.stubGlobal('MediaRecorder', MockMediaRecorder)
        vi.stubGlobal('navigator', {
            mediaDevices: {
                getUserMedia: vi.fn(async () => ({
                    getTracks: () => [{ stop: vi.fn() }],
                })),
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('calls onSend when form is submitted with text', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Hello' } })
        fireEvent.submit(textarea.closest('form'))
        expect(onSend).toHaveBeenCalledWith('Hello')
    })

    it('does not call onSend when text is empty', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        fireEvent.submit(screen.getByPlaceholderText('Type...').closest('form'))
        expect(onSend).not.toHaveBeenCalled()
    })

    it('sends on Enter key (not Shift+Enter)', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Test message' } })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false })
        expect(onSend).toHaveBeenCalledWith('Test message')
    })

    it('does not send on Shift+Enter', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Test' } })
        fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
        expect(onSend).not.toHaveBeenCalled()
    })

    it('disables input when disabled prop is true', () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} disabled placeholder="Type..." />)
        expect(screen.getByPlaceholderText('Type...')).toBeDisabled()
    })

    it('renders mic button', () => {
        render(<ChatInput onSend={vi.fn()} placeholder="Type..." />)
        expect(screen.getByRole('button', { name: 'Record speech' })).toBeInTheDocument()
    })

    it('inserts transcript into textarea without auto-send', async () => {
        vi.mocked(transcribeSpeech).mockResolvedValueOnce({ text: 'Show my visits', language: null })
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." />)

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Record speech' }))
        })
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument()
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
            await Promise.resolve()
            await Promise.resolve()
        })

        await waitFor(() => {
            expect(vi.mocked(transcribeSpeech)).toHaveBeenCalledTimes(1)
        })

        const textarea = screen.getByPlaceholderText('Type...')
        expect(textarea).toHaveValue('Show my visits')
        expect(onSend).not.toHaveBeenCalled()
    })

    it('appends transcript when textarea already has text', async () => {
        vi.mocked(transcribeSpeech).mockResolvedValueOnce({ text: 'the second one', language: null })
        render(<ChatInput onSend={vi.fn()} placeholder="Type..." />)

        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Vendor Meeting' } })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Record speech' }))
        })
        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Stop recording' })).toBeInTheDocument()
        })

        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Stop recording' }))
            await Promise.resolve()
            await Promise.resolve()
        })

        await waitFor(() => {
            expect(textarea).toHaveValue('Vendor Meeting the second one')
        })
    })
})
