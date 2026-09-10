/**
 * Builds user-visible orchestration lines after a menu card click so BPMN/classifiers receive stable text.
 *
 * Prefer backend `selectionSignal` on each `menuitem`; this module formats a fallback aligned with BPMN wording.
 *
 * Prefixes match router expectations:
 * - `[catering-menu] `
 * - `[it_support-menu] `
 * - `[facilities-menu] `
 * - `[student_absence-menu] `
 * - `[banner_error-menu] `
 *
 * @file
 * @module utils/menuSelection
 */

/** BPMN-aligned user-input prefixes including trailing space. */
export const MENU_PREFIX = {
    catering: '[catering-menu] ',
    it_support: '[it_support-menu] ',
    facilities_maintenance: '[facilities-menu] ',
    student_absence: '[student_absence-menu] ',
    banner_error: '[banner_error-menu] ',
}

/**
 * True when {@code userInput} is a menu-card selection signal (not free-typed text).
 * Used when mapping GET conversation turns so {@code displayText} is only trusted for menu clicks.
 * Attachment markers ({@code [attachment] ...}) are NOT menu selections.
 *
 * @param {string|null|undefined} userInput
 * @returns {boolean}
 */
export function isMenuSelectionUserInput(userInput) {
    if (userInput == null || typeof userInput !== 'string') return false
    const s = userInput.trimStart()
    return Object.values(MENU_PREFIX).some((prefix) => s.startsWith(prefix))
}

/**
 * True when the stored userInput is an absence attachment marker.
 *
 * @param {string|null|undefined} userInput
 * @returns {boolean}
 */
export function isAttachmentMarkerUserInput(userInput) {
    if (userInput == null || typeof userInput !== 'string') return false
    return userInput.trimStart().startsWith('[attachment]')
}

/**
 * True when handledBy identifies the Error Banner agent (wire or display name).
 * Must not match generic {@code ERROR} / RouteCategory.ERROR.
 *
 * @param {string|null|undefined} handledBy
 * @returns {boolean}
 */
export function isBannerErrorHandledBy(handledBy) {
    if (handledBy == null || handledBy === '') return false
    const u = String(handledBy).trim().toUpperCase()
    return u === 'BANNER_ERROR'
        || u.includes('BANNER_ERROR')
        || u.includes('ERROR BANNER')
}

/**
 * True when handledBy identifies the student absence agent (wire or display name).
 *
 * @param {string|null|undefined} handledBy
 * @returns {boolean}
 */
export function isStudentAbsenceHandledBy(handledBy) {
    if (handledBy == null || handledBy === '') return false
    const u = String(handledBy).trim().toUpperCase()
    return u.includes('ABSENCE') || u.includes('STUDENT_ABSENCE')
}

/**
 * Maps persisted enum names or SSE labels to a menu click prefix.
 * Unknown handlers return null (do NOT default to catering).
 *
 * @param {string|null|undefined} handledBy
 * @returns {string|null} prefix including trailing space, or null
 */
export function resolveMenuPrefixFromHandledBy(handledBy) {
    if (handledBy == null || handledBy === '') return null
    const u = String(handledBy).trim().toUpperCase()
    // Banner before any broad ERROR match — never use includes('ERROR') alone.
    if (isBannerErrorHandledBy(handledBy)) return MENU_PREFIX.banner_error
    if (u.includes('ABSENCE') || u.includes('STUDENT_ABSENCE')) return MENU_PREFIX.student_absence
    if (u.includes('FACILITIES')) return MENU_PREFIX.facilities_maintenance
    if (u.includes('IT_SUPPORT') || u === 'IT SUPPORT' || u.includes('IT SUPPORT')) return MENU_PREFIX.it_support
    if (u.includes('CATERING')) return MENU_PREFIX.catering
    return null
}

/** Same sanitisation axis as AgentResponsePostProcessor.selectionSignal */
function safeMenuName(name) {
    return String(name ?? '')
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ')
        .replace(/\t/g, ' ')
}

function nameClause(displayLabel) {
    const n = safeMenuName(displayLabel).trim()
    if (!n) return ''
    return ` (name: ${n})`
}

function isServiceRequestPrefix(prefix) {
    return prefix === MENU_PREFIX.it_support || prefix === MENU_PREFIX.facilities_maintenance
}

/**
 * Fallback formatter when a click arrives without backend `selectionSignal`.
 *
 * @param {object|string|null} item
 * @param {string|null|undefined} handledBy
 * @returns {{ agentInput: string, displayText: string|null }}
 */
export function formatMenuSelectionMessage(item, handledBy) {
    const prefix = resolveMenuPrefixFromHandledBy(handledBy)

    if (item == null || typeof item !== 'object') {
        const s = String(item ?? '')
        return { agentInput: s, displayText: null }
    }
    const rawLabel = (item.label ?? item.name ?? '').trim()
    const displayText = rawLabel || null
    const id = item.id != null ? String(item.id).trim() : ''
    if (!id) {
        return {
            agentInput: prefix ? `${prefix}Missing item id` : 'Missing item id',
            displayText,
        }
    }

    // Student absence: single-level Reason cards.
    if (prefix === MENU_PREFIX.student_absence) {
        return {
            agentInput: `${prefix}Selected Reason${nameClause(rawLabel)} (id: ${id})`,
            displayText,
        }
    }

    // Without a known prefix, prefer selectionSignal path; last resort uses bare id.
    if (!prefix) {
        return {
            agentInput: rawLabel ? `Selected ${rawLabel} (id: ${id})` : `Selected (id: ${id})`,
            displayText,
        }
    }

    if (isServiceRequestPrefix(prefix)) {
        const parentId = item.categoryId != null && item.categoryId !== '' ? String(item.categoryId).trim() : ''
        if (parentId) {
            return {
                agentInput: `${prefix}Selected Item${nameClause(rawLabel)} (id: ${id})`,
                displayText,
            }
        }
        return {
            agentInput: `${prefix}Selected Subcategory${nameClause(rawLabel)} (id: ${id})`,
            displayText,
        }
    }

    // Catering + banner_error (and similar): Category → Subcategory → Product.
    // Banner is single-level Category (no code / categoryId) — falls through to Selected Category.
    if (item.code != null && item.code !== '') {
        return {
            agentInput: `${prefix}Selected Product${nameClause(rawLabel)} (id: ${id})`,
            displayText,
        }
    }
    if (item.categoryId != null && item.categoryId !== '') {
        return {
            agentInput: `${prefix}Selected Subcategory${nameClause(rawLabel)} (id: ${id})`,
            displayText,
        }
    }
    return {
        agentInput: `${prefix}Selected Category${nameClause(rawLabel)} (id: ${id})`,
        displayText,
    }
}
