/**
 * @file Guest-mode Visit ID setup bar (orchestration chatContext prerequisite).
 * @module components/layout/GuestVisitIdBar
 */

import { useState, useEffect } from 'react'
import PropTypes from 'prop-types'
import {
    getRuntimeVisitId,
    setRuntimeVisitId,
    normalizeVisitId,
    hasConfiguredVisitId,
    getVisitIdRequiredMessage,
} from '../../config/chatContext.js'
import './GuestVisitIdBar.css'

export default function GuestVisitIdBar({ onVisitConfigured }) {
    const [input, setInput] = useState(() => getRuntimeVisitId())
    const [error, setError] = useState(null)
    const configured = hasConfiguredVisitId()

    useEffect(() => {
        if (configured) {
            onVisitConfigured?.()
        }
    }, [configured, onVisitConfigured])

    const handleSave = (e) => {
        e.preventDefault()
        const normalized = normalizeVisitId(input)
        if (!normalized) {
            setError('Enter a valid Visit UUID.')
            return
        }
        setRuntimeVisitId(normalized)
        setInput(normalized)
        setError(null)
        onVisitConfigured?.()
    }

    if (configured) {
        const active = getRuntimeVisitId()
        return (
            <div className="guest-visit-bar guest-visit-bar--configured" role="status">
                <span className="guest-visit-bar-label">Visit ID</span>
                <code className="guest-visit-bar-value">{active}</code>
            </div>
        )
    }

    return (
        <div className="guest-visit-bar" role="region" aria-label="Visit ID setup">
            <p className="guest-visit-bar-hint">{getVisitIdRequiredMessage(import.meta.env, true)}</p>
            <form className="guest-visit-bar-form" onSubmit={handleSave}>
                <label htmlFor="guest-visit-id-input" className="guest-visit-bar-label">
                    Visit UUID
                </label>
                <input
                    id="guest-visit-id-input"
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="550e8400-e29b-41d4-a716-446655440000"
                    spellCheck={false}
                    autoComplete="off"
                />
                <button type="submit">Save</button>
            </form>
            {error && <p className="guest-visit-bar-error" role="alert">{error}</p>}
        </div>
    )
}

GuestVisitIdBar.propTypes = {
    onVisitConfigured: PropTypes.func,
}
