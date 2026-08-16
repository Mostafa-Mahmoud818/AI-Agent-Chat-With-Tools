/**
 * @file Composer input (textarea + mic + send) for the chat pane.
 * @module components/chat/ChatInput
 */

import { useState, useRef, useCallback, forwardRef, useImperativeHandle, useEffect } from 'react'
import PropTypes from 'prop-types'
import { AUDIO_MAX_BYTES, CHAT_INPUT_MAX } from '../../config/chattingValidationLimits.js'
import { transcribeSpeech, ApiError } from '../../services/api.js'
import './ChatInput.css'

const PREFERRED_MIME = 'audio/webm'

function resizeTextarea(textarea) {
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px'
}

const ChatInput = forwardRef(function ChatInput({ onSend, placeholder, disabled }, ref) {
    const [text, setText] = useState('')
    const [recording, setRecording] = useState(false)
    const [transcribing, setTranscribing] = useState(false)
    const [sttError, setSttError] = useState(null)
    const [languageHint, setLanguageHint] = useState('') // '' = auto-detect, 'en', 'ar'
    const inputRef = useRef(null)
    const mediaRecorderRef = useRef(null)
    const audioChunksRef = useRef([])
    const mediaStreamRef = useRef(null)
    const recordedMimeRef = useRef(PREFERRED_MIME)
    const recordingRef = useRef(false)
    const languageHintRef = useRef('')

    useEffect(() => {
        recordingRef.current = recording
    }, [recording])

    useEffect(() => {
        languageHintRef.current = languageHint
    }, [languageHint])

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

    const canSend = text.trim() && !disabled && !transcribing
    const micDisabled = disabled || transcribing

    const handleInput = useCallback((e) => {
        setText(e.target.value)
        setSttError(null)
        resizeTextarea(e.target)
    }, [])

    const submit = useCallback(() => {
        const trimmed = text.trim()
        if (!trimmed || disabled || transcribing) return
        onSend(trimmed)
        setText('')
        setSttError(null)
        if (inputRef.current) {
            inputRef.current.style.height = 'auto'
            inputRef.current.focus()
        }
    }, [text, disabled, transcribing, onSend])

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

    const handleMicClick = useCallback(async () => {
        if (disabled || transcribing) return

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
    }, [appendTranscript, disabled, stopMediaTracks, transcribing])

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
            <div className="chat-input-wrapper">
                <textarea
                    ref={inputRef}
                    className="chat-input"
                    value={text}
                    onChange={handleInput}
                    onKeyDown={handleKeyDown}
                    placeholder={placeholder}
                    rows={1}
                    maxLength={CHAT_INPUT_MAX}
                    disabled={disabled || transcribing}
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
        </form>
    )
})

ChatInput.propTypes = {
    onSend: PropTypes.func.isRequired,
    placeholder: PropTypes.string,
    disabled: PropTypes.bool,
}

export default ChatInput
