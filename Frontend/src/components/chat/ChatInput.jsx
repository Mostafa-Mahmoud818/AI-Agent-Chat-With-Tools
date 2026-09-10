/**
 * @file Composer input (textarea + mic + send + optional attach/date) for the chat pane.
 * @module components/chat/ChatInput
 */

import { useState, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react'
import PropTypes from 'prop-types'
import {
    ABSENCE_ATTACHMENT_ALLOWED_TYPES,
    ABSENCE_ATTACHMENT_MAX_BYTES,
    AUDIO_MAX_BYTES,
    CHAT_INPUT_MAX,
} from '../../config/chattingValidationLimits.js'
import { transcribeSpeech, uploadAbsenceChatAttachment, uploadErrorBannerChatAttachment, ApiError } from '../../services/api.js'
import { isBannerErrorHandledBy, isStudentAbsenceHandledBy } from '../../utils/menuSelection.js'
import './ChatInput.css'

const PREFERRED_MIME = 'audio/webm'

/**
 * Inclusive HTML min for dateTo = calendar day after afterDate (exclusive server rule).
 * @param {string|null|undefined} afterDate YYYY-MM-DD
 * @returns {string|undefined}
 */
export function exclusiveDateMin(afterDate) {
    if (!afterDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(afterDate).trim())) return undefined
    const d = new Date(`${String(afterDate).trim()}T00:00:00Z`)
    if (Number.isNaN(d.getTime())) return undefined
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
}

function resizeTextarea(textarea) {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
}

function formatBytes(n) {
    if (n == null || !Number.isFinite(n)) return ''
    if (n < 1024) return `${n} B`
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
    return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * @param {{
 *   onSend: (text: string, opts?: { displayText?: string|null }) => void|boolean|Promise<void|boolean>,
 *   placeholder?: string,
 *   disabled?: boolean,
 *   composerMode?: 'default'|'attachment_request'|'date_request'|null,
 *   dateConstraint?: { field?: string|null, afterDate?: string|null }|null,
 *   attachmentHandledBy?: string|null,
 * }} props
 */
const ChatInput = forwardRef(function ChatInput({
    onSend,
    placeholder,
    disabled,
    composerMode = 'default',
    dateConstraint = null,
    attachmentHandledBy = null,
}, ref) {
    const [text, setText] = useState('')
    const [recording, setRecording] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [sttError, setSttError] = useState(null)
    const [attachError, setAttachError] = useState(null)
    const [uploading, setUploading] = useState(false)
    const [attachPreview, setAttachPreview] = useState(null)
    const [languageHint, setLanguageHint] = useState('')
    const [pickedDate, setPickedDate] = useState('')
    const inputRef = useRef(null)
    const fileInputRef = useRef(null)
    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const mediaStreamRef = useRef(null)
    const recordedMimeRef = useRef(PREFERRED_MIME)
    const recordingRef = useRef(false)
    const languageHintRef = useRef('')

    const showAttach = composerMode === 'attachment_request'
    const showDate = composerMode === 'date_request'
    const dateMin = showDate && dateConstraint?.field === 'dateTo'
        ? exclusiveDateMin(dateConstraint.afterDate)
        : undefined

    useEffect(() => {
        recordingRef.current = recording
    }, [recording])

    useEffect(() => {
        languageHintRef.current = languageHint
    }, [languageHint])

    useEffect(() => {
        // Clear attach/date local state when composer mode changes.
        setAttachError(null)
        setAttachPreview(null)
        setPickedDate('')
        if (fileInputRef.current) fileInputRef.current.value = ''
    }, [composerMode])

    useImperativeHandle(ref, () => ({
        focus() {
            inputRef.current?.focus()
        }
    }), [])

    const stopMediaTracks = useCallback(() => {
        mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
    }, [])

    const appendTranscript = useCallback((transcript) => {
        const trimmed = transcript.trim()
        if (!trimmed) return
        setText((prev) => {
            const base = prev.trim()
            const next = base ? `${base} ${trimmed}` : trimmed
            return next.slice(0, CHAT_INPUT_MAX)
        })
        requestAnimationFrame(() => {
            resizeTextarea(inputRef.current)
            inputRef.current?.focus()
        })
    }, [])

    useEffect(() => () => {
        if (mediaRecorderRef.current?.state === 'recording') {
            mediaRecorderRef.current.stop()
        }
        stopMediaTracks()
    }, [stopMediaTracks])

    const busy = disabled || transcribing || uploading
    const canSend = Boolean(text.trim() || (showDate && pickedDate)) && !busy
    const micDisabled = busy

    const handleInput = useCallback((e) => {
        setText(e.target.value)
        setSttError(null)
        resizeTextarea(e.target)
    }, [])

    const submit = useCallback(async () => {
        if (busy) return
        const trimmed = text.trim()
        const dateToSend = showDate && pickedDate && !trimmed ? pickedDate : trimmed
        if (!dateToSend) return
        const accepted = await Promise.resolve(onSend(dateToSend))
        if (accepted === false) return
        setText('')
        setPickedDate('')
        setSttError(null)
        setAttachError(null)
        if (inputRef.current) {
            inputRef.current.style.height = 'auto'
            inputRef.current.focus()
        }
    }, [text, busy, onSend, showDate, pickedDate])

    const handleSubmit = useCallback((e) => {
        e.preventDefault()
        submit()
    }, [submit])

    const handleKeyDown = useCallback((e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            submit()
        }
    }, [submit])

    const handleDateChange = useCallback((e) => {
        const v = e.target.value
        setPickedDate(v)
        if (v) setText(v)
    }, [])

    const handleFileChange = useCallback(async (e) => {
        const file = e.target.files?.[0]
        if (!file) return
        setAttachError(null)
        setAttachPreview(null)

        if (file.size > ABSENCE_ATTACHMENT_MAX_BYTES) {
            setAttachError('Supporting document must not exceed 10 MB.')
            e.target.value = ''
            return
        }
        const mime = (file.type || '').toLowerCase()
        if (mime && !ABSENCE_ATTACHMENT_ALLOWED_TYPES.includes(mime)) {
            setAttachError('Unsupported file type. Allowed: PDF, JPEG, PNG, WEBP, DOC, DOCX.')
            e.target.value = ''
            return
        }

        setUploading(true)
        try {
            let uploadFn = null
            if (isBannerErrorHandledBy(attachmentHandledBy)) {
                uploadFn = uploadErrorBannerChatAttachment
            } else if (isStudentAbsenceHandledBy(attachmentHandledBy)) {
                uploadFn = uploadAbsenceChatAttachment
            }
            if (!uploadFn) {
                setAttachError('Could not determine where to send this file. Please try again from the assistant prompt.')
                return
            }
            const result = await uploadFn(file)
            const displayText = `Attached: ${result.originalFileName || file.name}${result.sizeBytes != null ? ` (${formatBytes(result.sizeBytes)})` : ''}`
            setAttachPreview({
                name: result.originalFileName || file.name,
                sizeBytes: result.sizeBytes,
            })
            const accepted = await Promise.resolve(onSend(result.chatFollowUpMessage, { displayText }))
            if (accepted === false) {
                setAttachPreview(null)
                return
            }
            setText('')
            setAttachPreview(null)
        } catch (err) {
            const message = err instanceof ApiError
                ? err.message
                : 'Could not upload attachment. Please try again.'
            setAttachError(message)
        } finally {
            setUploading(false)
            if (fileInputRef.current) fileInputRef.current.value = ''
        }
    }, [onSend, attachmentHandledBy])

    const handleMicClick = useCallback(async () => {
        if (busy) return

        if (recordingRef.current) {
            mediaRecorderRef.current?.stop()
            return
        }

        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
            setSttError('Microphone is not supported in this browser.')
            return
        }
        if (typeof MediaRecorder === 'undefined') {
            setSttError('Audio recording is not supported in this browser.')
            return
        }

        setSttError(null)
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
            mediaStreamRef.current = stream
            const mimeType = MediaRecorder.isTypeSupported(PREFERRED_MIME) ? PREFERRED_MIME : undefined
            recordedMimeRef.current = mimeType || PREFERRED_MIME
            const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
            audioChunksRef.current = []

            recorder.ondataavailable = (event) => {
                if (event.data?.size > 0) {
                    audioChunksRef.current.push(event.data)
                }
            }

            recorder.onstop = async () => {
                setRecording(false)
                stopMediaTracks()
                mediaRecorderRef.current = null

                const blob = new Blob(audioChunksRef.current, { type: recordedMimeRef.current })
                audioChunksRef.current = []
                if (blob.size === 0) return
                if (blob.size > AUDIO_MAX_BYTES) {
                    setSttError('Recording is too large (max 25 MB). Please record a shorter clip.')
                    return
                }

                setTranscribing(true)
                try {
                    const hint = languageHintRef.current || null
                    const result = await transcribeSpeech(blob, { filename: 'recording.webm', languageHint: hint })
                    appendTranscript(result?.text ?? '')
                } catch (err) {
                    const message = err instanceof ApiError
                        ? err.message
                        : 'Could not transcribe audio. Please try again.'
                    setSttError(message)
                } finally {
                    setTranscribing(false)
                }
            }

            recorder.onerror = () => {
                setRecording(false)
                stopMediaTracks()
                mediaRecorderRef.current = null
                setSttError('Recording failed. Please try again.')
            }

            mediaRecorderRef.current = recorder
            recorder.start()
            setRecording(true)
        } catch {
            stopMediaTracks()
            mediaRecorderRef.current = null
            setSttError('Microphone access denied or unavailable.')
        }
    }, [appendTranscript, busy, stopMediaTracks])

    const micLabel = transcribing
        ? 'Transcribing speech'
        : recording
            ? 'Stop recording'
            : 'Record speech'

    return (
        <form className="chat-input-form" onSubmit={handleSubmit}>
            {sttError && (
                <div className="chat-input-stt-error" role="alert">
                    {sttError}
                </div>
            )}
            {attachError && (
                <div className="chat-input-stt-error" role="alert">
                    {attachError}
                </div>
            )}
            {showAttach && (
                <div className="chat-input-attach-row">
                    <input
                        id="chat-input-file"
                        ref={fileInputRef}
                        type="file"
                        className="sr-only"
                        accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,application/pdf,image/jpeg,image/png,image/webp,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        disabled={busy}
                        onChange={handleFileChange}
                        aria-label="Attach supporting document"
                    />
                    <label htmlFor="chat-input-file" className={`chat-input-attach-btn${busy ? ' is-disabled' : ''}`}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
                        </svg>
                        {uploading ? 'Uploading…' : 'Choose file'}
                    </label>
                    <span className="chat-input-attach-hint">
                        {uploading
                            ? 'Uploading…'
                            : 'PDF, image, or DOC/DOCX · max 10 MB — or type if you cannot attach.'}
                    </span>
                    {attachPreview && (
                        <span className="chat-input-attach-preview">
                            {attachPreview.name}
                            {attachPreview.sizeBytes != null ? ` (${formatBytes(attachPreview.sizeBytes)})` : ''}
                        </span>
                    )}
                </div>
            )}
            {showDate && (
                <div className="chat-input-date-row">
                    <label htmlFor="chat-input-date" className="chat-input-date-label">
                        {dateConstraint?.field === 'dateTo' ? 'End date' : 'Start date'}
                    </label>
                    <input
                        id="chat-input-date"
                        type="date"
                        className="chat-input-date"
                        value={pickedDate}
                        min={dateMin}
                        disabled={busy}
                        onChange={handleDateChange}
                    />
                </div>
            )}
            <div className="chat-input-wrapper">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={text}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={
                        showAttach
                            ? (placeholder || 'Type a message, or attach a file above…')
                            : showDate
                                ? (placeholder || 'Pick a date above, or type YYYY-MM-DD…')
                                : placeholder
                    }
                    rows={1}
                    maxLength={CHAT_INPUT_MAX}
                    disabled={busy}
                    autoFocus
                />
                <select
                    className="stt-lang-select"
                    value={languageHint}
                    onChange={(e) => setLanguageHint(e.target.value)}
                    disabled={micDisabled || recording}
                    aria-label="Speech language"
                    title="Speech recognition language"
                >
                    <option value="">Auto</option>
                    <option value="en">EN</option>
                    <option value="ar">AR</option>
                </select>
                <button
                    type="button"
                    className={`mic-btn ${recording ? 'recording' : ''} ${transcribing ? 'transcribing' : ''}`}
                    disabled={micDisabled}
                    aria-label={micLabel}
                    aria-pressed={recording}
                    onClick={handleMicClick}
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="23" />
                        <line x1="8" y1="23" x2="16" y2="23" />
                    </svg>
                </button>
                <button
                    type="submit"
                    className={`send-btn ${canSend ? 'active' : ''}`}
                    disabled={!canSend}
                    aria-label="Send message"
                >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="22" y1="2" x2="11" y2="13" />
                        <polygon points="22 2 15 22 11 13 2 9 22 2" />
                    </svg>
                </button>
            </div>
            <div className="chat-input-meta">
                <span className="chat-input-hint">Enter to send · Shift+Enter for a new line</span>
                {text.length > 0 && (
                    <span className={`chat-input-count${text.length > CHAT_INPUT_MAX - 80 ? ' is-warn' : ''}`}>
                        {text.length}/{CHAT_INPUT_MAX}
                    </span>
                )}
            </div>
        </form>
    )
})

ChatInput.propTypes = {
    onSend: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    disabled: PropTypes.bool,
    composerMode: PropTypes.oneOf(['default', 'attachment_request', 'date_request']),
    dateConstraint: PropTypes.shape({
        field: PropTypes.string,
        afterDate: PropTypes.string,
    }),
    attachmentHandledBy: PropTypes.string,
}

export default ChatInput
