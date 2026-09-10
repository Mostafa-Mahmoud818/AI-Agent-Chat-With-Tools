import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { transcribeSpeech, uploadAbsenceChatAttachment, uploadErrorBannerChatAttachment } from '../../services/api.js'
import ChatInput from '../chat/ChatInput'

vi.mock('../../services/api.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        transcribeSpeech: vi.fn(),
        uploadAbsenceChatAttachment: vi.fn(),
        uploadErrorBannerChatAttachment: vi.fn(),
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
        vi.mocked(uploadAbsenceChatAttachment).mockReset()
        vi.mocked(uploadErrorBannerChatAttachment).mockReset()
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

    it('shows attach control in attachment_request mode and sends verbatim follow-up', async () => {
        vi.mocked(uploadAbsenceChatAttachment).mockResolvedValueOnce({
            chatFollowUpMessage: '[attachment] path=a/b.pdf filename=note.pdf type=application/pdf',
            originalFileName: 'note.pdf',
            sizeBytes: 42,
        })
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." composerMode="attachment_request" attachmentHandledBy="STUDENT_ABSENCE" />)

        const fileInput = screen.getByLabelText('Attach supporting document')
        const file = new File(['x'], 'note.pdf', { type: 'application/pdf' })
        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [file] } })
        })

        await waitFor(() => {
            expect(uploadAbsenceChatAttachment).toHaveBeenCalledTimes(1)
            expect(onSend).toHaveBeenCalledWith(
                '[attachment] path=a/b.pdf filename=note.pdf type=application/pdf',
                { displayText: 'Attached: note.pdf (42 B)' },
            )
        })
    })

    it('routes banner_error attach uploads to errorbanner endpoint', async () => {
        vi.mocked(uploadErrorBannerChatAttachment).mockResolvedValueOnce({
            chatFollowUpMessage: '[attachment] path=banner/x.png filename=x.png type=image/png',
            originalFileName: 'x.png',
            sizeBytes: 10,
        })
        const onSend = vi.fn(async () => true)
        render(
            <ChatInput
                onSend={onSend}
                placeholder="Type..."
                composerMode="attachment_request"
                attachmentHandledBy="Error Banner Agent"
            />,
        )

        const fileInput = screen.getByLabelText('Attach supporting document')
        const file = new File(['x'], 'x.png', { type: 'image/png' })
        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [file] } })
        })

        await waitFor(() => {
            expect(uploadErrorBannerChatAttachment).toHaveBeenCalledTimes(1)
            expect(uploadAbsenceChatAttachment).not.toHaveBeenCalled()
        })
    })

    it('rejects oversized attach clientside without uploading', async () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." composerMode="attachment_request" attachmentHandledBy="STUDENT_ABSENCE" />)
        const fileInput = screen.getByLabelText('Attach supporting document')
        const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'big.pdf', { type: 'application/pdf' })
        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [big] } })
        })
        expect(uploadAbsenceChatAttachment).not.toHaveBeenCalled()
        expect(onSend).not.toHaveBeenCalled()
        expect(screen.getByText(/must not exceed 10 MB/i)).toBeInTheDocument()
    })

    it('does not upload when attachmentHandledBy is missing (no absence default)', async () => {
        const onSend = vi.fn()
        render(<ChatInput onSend={onSend} placeholder="Type..." composerMode="attachment_request" />)
        const fileInput = screen.getByLabelText('Attach supporting document')
        const file = new File(['x'], 'note.pdf', { type: 'application/pdf' })
        await act(async () => {
            fireEvent.change(fileInput, { target: { files: [file] } })
        })
        expect(uploadAbsenceChatAttachment).not.toHaveBeenCalled()
        expect(uploadErrorBannerChatAttachment).not.toHaveBeenCalled()
        expect(onSend).not.toHaveBeenCalled()
        expect(screen.getByText(/could not determine where to send this file/i)).toBeInTheDocument()
    })

    it('keeps composer text when onSend returns false', async () => {
        const onSend = vi.fn(async () => false)
        render(<ChatInput onSend={onSend} placeholder="Type..." />)
        const textarea = screen.getByPlaceholderText('Type...')
        fireEvent.change(textarea, { target: { value: 'Keep me' } })
        await act(async () => {
            fireEvent.submit(textarea.closest('form'))
        })
        await waitFor(() => expect(onSend).toHaveBeenCalledWith('Keep me'))
        expect(textarea).toHaveValue('Keep me')
    })

    it('shows date picker with exclusive min for dateTo constraint', () => {
        render(
            <ChatInput
                onSend={vi.fn()}
                placeholder="Type..."
                composerMode="date_request"
                dateConstraint={{ field: 'dateTo', afterDate: '2026-09-01' }}
            />,
        )
        expect(screen.getByLabelText('End date')).toBeInTheDocument()
        expect(screen.getByLabelText('End date')).toHaveAttribute('min', '2026-09-02')
    })
})
