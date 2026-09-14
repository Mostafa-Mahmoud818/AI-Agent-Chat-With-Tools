/**
 * @file Visitor / Student persona switcher when both context ids are available.
 * @module components/layout/PersonaPicker
 */

import PropTypes from 'prop-types'
import {
    getAvailablePersonas,
    getActivePersona,
    PERSONA_STUDENT,
    PERSONA_VISITOR,
    setActivePersona,
    ensureActivePersona,
} from '../../config/personaSession.js'
import './PersonaPicker.css'

/**
 * @param {{ onPersonaChange?: (persona: 'VISITOR'|'STUDENT') => void, disabled?: boolean }} props
 */
export default function PersonaPicker({ onPersonaChange, disabled = false }) {
    const available = getAvailablePersonas()
    if (available.length < 2) return null

    const active = getActivePersona() || ensureActivePersona()

    const select = (persona) => {
        if (disabled || persona === active) return
        setActivePersona(persona)
        onPersonaChange?.(persona)
    }

    return (
        <div className="persona-picker" role="group" aria-label="Chat persona">
            <span className="persona-picker-label">Persona</span>
            <button
                type="button"
                className={`persona-picker-btn${active === PERSONA_VISITOR ? ' persona-picker-btn--active' : ''}`}
                aria-pressed={active === PERSONA_VISITOR}
                disabled={disabled}
                onClick={() => select(PERSONA_VISITOR)}
            >
                Visitor
            </button>
            <button
                type="button"
                className={`persona-picker-btn${active === PERSONA_STUDENT ? ' persona-picker-btn--active' : ''}`}
                aria-pressed={active === PERSONA_STUDENT}
                disabled={disabled}
                onClick={() => select(PERSONA_STUDENT)}
            >
                Student
            </button>
        </div>
    )
}

PersonaPicker.propTypes = {
    onPersonaChange: PropTypes.func,
    disabled: PropTypes.bool,
}
