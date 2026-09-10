/**
 * @file Client-side limits aligned with backend {@code ChattingValidationLimits}.
 * @module config/chattingValidationLimits
 */

/** User/orchestration primary text ({@code inputText}, {@code followUpInput}). */
export const CHAT_INPUT_MAX = 8000

/** Optional UI companion text on start/follow-up. */
export const DISPLAY_TEXT_MAX = 4000

/** Conversation {@code initialTitle}. */
export const CONVERSATION_TITLE_MAX = 255

/** Max audio upload size for speech transcription. Mirrors backend {@code SpeechProperties.DEFAULT_MAX_BYTES} (25 MiB). */
export const AUDIO_MAX_BYTES = 26_214_400

/** Max absence supporting document size. Mirrors {@code AbsenceAttachmentStorageService.MAX_BYTES} (10 MiB). */
export const ABSENCE_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024

/** Allowed MIME types for absence chat attachments. */
export const ABSENCE_ATTACHMENT_ALLOWED_TYPES = [
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

/** Allowed transcription language hints; blank/null = auto-detect. Mirrors backend {@code SpeechProperties} allowed languages. */
export const SPEECH_LANGUAGE_HINTS = ['en', 'ar']

/**
 * @param {unknown} text
 * @param {number} max
 * @returns {string}
 */
export function clampToMax(text, max) {
    if (text == null) return ''
    const s = String(text)
    return s.length <= max ? s : s.slice(0, max)
}

/**
 * @param {unknown} text
 * @returns {string}
 */
export function clampChatInput(text) {
    return clampToMax(text, CHAT_INPUT_MAX)
}

/**
 * @param {unknown} text
 * @returns {string|null} trimmed display text or null when empty
 */
export function clampDisplayText(text) {
    if (text == null) return null
    const s = clampToMax(String(text).trim(), DISPLAY_TEXT_MAX)
    return s === '' ? null : s
}

/**
 * @param {unknown} titleSeed
 * @returns {string}
 */
export function clampConversationTitle(titleSeed) {
    const s = clampToMax(titleSeed, CONVERSATION_TITLE_MAX)
    if (s.length <= 50) return s
    return s.slice(0, 50) + '…'
}
