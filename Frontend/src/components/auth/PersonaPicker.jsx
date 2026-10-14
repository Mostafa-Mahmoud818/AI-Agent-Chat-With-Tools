import PropTypes from 'prop-types'
import { personaDisplayName } from '../../config/personaSession.js'

/**
 * Persona buttons shared by the OTP and UAE PASS sign-in steps.
 *
 * With {@code selected} (OTP) the buttons form a radio group and a click only selects; without it
 * (UAE PASS) each button is an action and a click acts at once.
 */
export default function PersonaPicker({ legend, personas, selected, onPick, disabled = false }) {
    const isRadioGroup = selected !== undefined
    return (
        <fieldset className="local-auth-persona" disabled={disabled}>
            <legend>{legend}</legend>
            <div
                className="local-auth-persona-grid"
                {...(isRadioGroup ? { role: 'radiogroup', 'aria-label': legend } : {})}
            >
                {personas.map((persona) => {
                    const active = isRadioGroup && selected === persona
                    return (
                        <button
                            key={persona}
                            type="button"
                            {...(isRadioGroup ? { role: 'radio', 'aria-checked': active } : {})}
                            className={`local-auth-persona-btn${active ? ' local-auth-persona-btn--active' : ''}`}
                            onClick={() => onPick(persona)}
                        >
                            {personaDisplayName(persona)}
                        </button>
                    )
                })}
            </div>
        </fieldset>
    )
}

PersonaPicker.propTypes = {
    legend: PropTypes.string.isRequired,
    personas: PropTypes.arrayOf(PropTypes.string).isRequired,
    /** Selected persona for a radio group (OTP); omit for action buttons (UAE PASS). */
    selected: PropTypes.string,
    onPick: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
}
