/**
 * @file Landing-screen "start a request" cards, loaded from the backend request-types endpoint.
 * @module components/chat/RequestTypeCards
 *
 * Labels, template prompts and icons all come from the server. The backend resolves the persona
 * from the JWT {@code persona_code} claim, so cards are only shown
 * when the picker's active persona matches that claim — otherwise they would belong to the wrong
 * persona. Load failures and empty lists render nothing; the user can still type freely.
 */

import {useEffect, useState} from 'react'
import PropTypes from 'prop-types'
import {getRequestTypes} from '../../services/api.js'
import {getAccessToken} from '../../auth/tokenStore.js'
import {readJwtPersonaCode} from '../../auth/jwtClaims.js'
import {canonicalizePersona} from '../../config/personaSession.js'
import {createLogger} from '../../utils/logger.js'
import './RequestTypeCards.css'

const log = createLogger('RequestTypeCards')

/** @returns {'ar'|'en'} */
export function resolveRequestTypesLang() {
    const lang = typeof navigator !== 'undefined' ? String(navigator.language || '') : ''
    return lang.toLowerCase().startsWith('ar') ? 'ar' : 'en'
}

const ICON_PROPS = {
    width: 26,
    height: 26,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
}

function ChatIcon() {
    return (
        <svg {...ICON_PROPS}>
            <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1 1 21 12z"/>
        </svg>
    )
}

/**
 * Only inline image data URIs from the server are rendered (served as {@code data:image/svg+xml;base64,...}).
 * They go into an {@code <img src>}, never into the DOM as markup, so SVG scripts cannot run.
 */
export function isRenderableIcon(icon) {
    return typeof icon === 'string' && /^data:image\/(svg\+xml|png|webp);base64,/.test(icon)
}

/**
 * @param {{ persona: 'VISITOR'|'STUDENT'|null, disabled?: boolean, onSelect: (type: { key: string, label: string, templatePrompt: string, icon?: string }) => void }} props
 */
export default function RequestTypeCards({persona, disabled = false, onSelect}) {
    const [types, setTypes] = useState([])
    const token = getAccessToken()
    const tokenPersona = canonicalizePersona(readJwtPersonaCode(token))
    const personaMatches = persona != null && tokenPersona === persona

    useEffect(() => {
        if (!personaMatches) {
            setTypes([])
            return undefined
        }
        let cancelled = false
        ;(async () => {
            try {
                const loaded = await getRequestTypes({lang: resolveRequestTypesLang()})
                if (!cancelled) setTypes(Array.isArray(loaded) ? loaded.filter((t) => t?.key && t?.templatePrompt) : [])
            } catch (err) {
                log.warn('Request types unavailable', err)
                if (!cancelled) setTypes([])
            }
        })()
        return () => {
            cancelled = true
        }
    }, [personaMatches, persona, token])

    if (types.length === 0) return null

    return (
        <section className="request-types" aria-labelledby="request-types-title">
            <h3 id="request-types-title" className="request-types-title">What are you looking for?</h3>
            <p className="request-types-subtitle">Ask a question or start a request.</p>
            <div className="request-types-list">
                {types.map((type) => (
                    <button
                        key={type.key}
                        type="button"
                        className="request-type-card"
                        disabled={disabled}
                        onClick={() => onSelect(type)}
                    >
                        <span className="request-type-icon">
                            {isRenderableIcon(type.icon)
                                ? <img src={type.icon} alt="" width={26} height={26}/>
                                : <ChatIcon/>}
                        </span>
                        <span className="request-type-label">{type.label}</span>
                    </button>
                ))}
            </div>
        </section>
    )
}

RequestTypeCards.propTypes = {
    persona: PropTypes.string,
    disabled: PropTypes.bool,
    onSelect: PropTypes.func.isRequired,
}
