/**
 * Builds user-visible orchestration lines after a menu card click so BPMN/classifiers receive stable text.
 *
 * Prefer backend `selectionSignal` on each `menuitem`; this module formats a fallback aligned with BPMN wording.
 *
 * Prefixes match router expectations (underscore for IT — `HandleClassifierFailure`):
 * - `[catering-menu] `
 * - `[it_support-menu] `
 * - `[facilities-menu] `
 *
 * @file
 * @module utils/menuSelection
 */

/** BPMN-aligned user-input prefixes including trailing space. */
export const MENU_PREFIX = {
    catering: '[catering-menu] ',
    it_support: '[it_support-menu] ',
    facilities_maintenance: '[facilities-menu] ',
}

/**
 * Maps persisted enum names or SSE labels to a menu click prefix.
 * @param {string|null|undefined} handledBy
 * @returns {string} prefix including trailing space
 */
export function resolveMenuPrefixFromHandledBy(handledBy) {
    if (handledBy == null || handledBy === '') return MENU_PREFIX.catering
    const u = String(handledBy).trim().toUpperCase()
    if (u.includes('FACILITIES')) return MENU_PREFIX.facilities_maintenance
    if (u.includes('IT_SUPPORT') || u === 'IT SUPPORT' || u.includes('IT SUPPORT')) return MENU_PREFIX.it_support
    if (u.includes('CATERING')) return MENU_PREFIX.catering
    return MENU_PREFIX.catering
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
 * Fallback formatter when `MenuBubble` forwards a click without backend `selectionSignal`.
 *
 * @param {object|string|null} item Clicked menu row (`id`, optional `label`/`name`, `categoryId`, `code`).
 * @param {string|null|undefined} handledBy Persisted/SSE route (`CATERING`, `IT_SUPPORT`, …).
 * @returns {{ agentInput: string, displayText: string|null }} Orchestration body (`agentInput`) and bubble label hint.
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
        return { agentInput: `${prefix}Missing item id.`, displayText }
    }

    // IT / F&M BPMN: Subcategory row vs Item leaf.
    if (isServiceRequestPrefix(prefix)) {
        const parentId = item.categoryId != null && item.categoryId !== '' ? String(item.categoryId).trim() : ''
        if (parentId) {
            return {
                agentInput: `${prefix}Selected Item${nameClause(rawLabel)} (id: ${id}).`,
                displayText,
            }
        }
        return {
            agentInput: `${prefix}Selected Subcategory${nameClause(rawLabel)} (id: ${id}).`,
            displayText,
        }
    }

    // Catering BPMN depth: Category → Subcategory → Product.
    if (item.code != null && item.code !== '') {
        const code = String(item.code).trim()
        return {
            agentInput: `${prefix}Selected Product${nameClause(rawLabel)} (id: ${id}) (code: ${code}).`,
            displayText,
        }
    }
    if (item.categoryId != null && item.categoryId !== '') {
        return {
            agentInput: `${prefix}Selected Subcategory${nameClause(rawLabel)} (id: ${id}).`,
            displayText,
        }
    }
    return {
        agentInput: `${prefix}Selected Category${nameClause(rawLabel)} (id: ${id}).`,
        displayText,
    }
}
