/**
 * @file Header sign-out. The chat persona is fixed at sign-in, so switching persona means signing
 * out and signing in again as the other persona.
 * @module components/layout/SignOutButton
 */

import PropTypes from 'prop-types'
import {getLockedPersona, personaDisplayName} from '../../config/personaSession.js'
import './SignOutButton.css'

/**
 * @param {{ onSignOut: () => void, disabled?: boolean }} props
 */
export default function SignOutButton({onSignOut, disabled = false}) {
    const persona = personaDisplayName(getLockedPersona())
    const title = persona
        ? `Signed in as ${persona}. Sign out to use a different persona.`
        : 'Sign out'

    return (
        <button
            type="button"
            className="sign-out-btn"
            onClick={onSignOut}
            disabled={disabled}
            title={title}
        >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                 strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
                <polyline points="16 17 21 12 16 7"/>
                <line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
            Sign out
        </button>
    )
}

SignOutButton.propTypes = {
    onSignOut: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
}
