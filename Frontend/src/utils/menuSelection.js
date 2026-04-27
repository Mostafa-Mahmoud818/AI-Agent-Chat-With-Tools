/**
 * Builds the user message after a menu card click so the classifier and specialist agent
 * see a stable, self-describing line in `currentInput` (ids + optional labels).
 *
 * Prefixes:
 * - `[catering-menu] ` — catering catalog (categories / subcategories / products)
 * - `[it-support-menu] ` — IT service areas and request items
 * - `[facilities-menu] ` — Facilities & Maintenance areas and request items
 *
 * Router BPMN treats these prefixes deterministically (classifier + classifier-failure recovery).
 *
 * @param {object} item - normalized menu item ({ id, label, code?, categoryId?, … })
 * @param {string|null|undefined} handledBy - message.handledBy from the AI bubble (e.g. IT_SUPPORT, CATERING, or SSE label)
 * @returns {{ agentInput: string, displayText: string|null }}
 */
export const MENU_PREFIX = {
    catering: '[catering-menu] ',
    it_support: '[it-support-menu] ',
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

function escapeForQuote(s) {
    return String(s).replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function isServiceRequestPrefix(prefix) {
    return prefix === MENU_PREFIX.it_support || prefix === MENU_PREFIX.facilities_maintenance
}

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

    // IT / F&M: area rows have categoryId null; leaf rows set categoryId to parent subcategory UUID.
    if (isServiceRequestPrefix(prefix)) {
        const parentId = item.categoryId != null && item.categoryId !== '' ? String(item.categoryId).trim() : ''
        const labelPart = rawLabel ? ` "${escapeForQuote(rawLabel)}"` : ''
        if (parentId) {
            return {
                agentInput: `${prefix}Selected service item${labelPart} (id: ${id}) (subcategoryId: ${parentId}).`,
                displayText,
            }
        }
        return {
            agentInput: `${prefix}Selected category${labelPart} (id: ${id}).`,
            displayText,
        }
    }

    if (item.code != null && item.code !== '') {
        const code = String(item.code).trim()
        const labelPart = rawLabel ? ` "${escapeForQuote(rawLabel)}"` : ''
        return {
            agentInput: `${prefix}Selected product${labelPart} (id: ${id}) (code: ${code}).`,
            displayText,
        }
    }
    if (item.categoryId != null && item.categoryId !== '') {
        const labelPart = rawLabel ? ` "${escapeForQuote(rawLabel)}"` : ''
        return {
            agentInput: `${prefix}Selected subcategory${labelPart} (id: ${id}).`,
            displayText,
        }
    }
    const labelPart = rawLabel ? ` "${escapeForQuote(rawLabel)}"` : ''
    return {
        agentInput: `${prefix}Selected category${labelPart} (id: ${id}).`,
        displayText,
    }
}
