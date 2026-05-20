import { useState } from 'react'
import PropTypes from 'prop-types'
import { createLogger } from '../../utils/logger.js'
import {
    exchangeLocalOtpForToken,
    prepareLocalOtpChallenge,
    shouldUseLocalOtpFlow,
} from '../../auth/localAccessTokenFlow.js'
import { setAccessToken } from '../../auth/tokenStore.js'
import { getBackendEnvLabel, resolveApiOrigin, API_BACKENDS } from '../../config/apiOrigin.js'
import {
    getRuntimeBackendEnv,
    setRuntimeBackendEnv,
    BACKEND_PRESETS,
} from '../../config/runtimeSettings.js'
import {
    getRuntimeVisitId,
    setRuntimeVisitId,
} from '../../config/chatContext.js'
import './LocalAuthDialog.css'

const log = createLogger('LocalAuthDialog')

const ENV_OPTIONS = [
    { label: 'DEV', description: 'dev-modulith.naitive.ai' },
    { label: 'TEST', description: 'test-modulith.naitive.ai' },
    { label: 'LOCAL', description: 'localhost:8085 (OTP)' },
]

function initialStep() {
    return getRuntimeBackendEnv() ? 'auth' : 'env'
}

export default function LocalAuthDialog({ onAuthenticated }) {
    const env = import.meta.env
    const [step, setStep] = useState(initialStep)
    const [envLabel, setEnvLabel] = useState(() => getBackendEnvLabel(env))
    const [origin, setOrigin] = useState(() => resolveApiOrigin(env))

    const [otpStep, setOtpStep] = useState('email')
    const [email, setEmail] = useState(env.VITE_LOCAL_AUTH_EMAIL ?? '')
    const [code, setCode] = useState('')
    const [token, setToken] = useState('')
    const [visitId, setVisitId] = useState(
        () => getRuntimeVisitId() || (env.VITE_DEFAULT_VISIT_ID ?? ''),
    )

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [hint, setHint] = useState(null)

    const isLocalOtp = shouldUseLocalOtpFlow(env)

    const handlePickEnv = (label) => {
        const previous = getRuntimeBackendEnv()
        setRuntimeBackendEnv(label)
        // If env actually changed, token from the old env is no longer valid.
        if (previous && previous !== label) {
            setAccessToken('')
            log.info('Backend env changed — clearing stored token', { from: previous, to: label })
            window.location.reload()
            return
        }
        // First-time selection (or same as previous) — reload so api.js modules
        // pick up the new origin cleanly.
        if (!previous) {
            window.location.reload()
            return
        }
        setEnvLabel(getBackendEnvLabel(env))
        setOrigin(resolveApiOrigin(env))
        setStep('auth')
    }

    const handleChangeEnv = () => {
        setError(null)
        setHint(null)
        setStep('env')
    }

    const submitEmail = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        setHint(null)
        try {
            await prepareLocalOtpChallenge(env, email)
            setOtpStep('otp')
            setHint('OTP sent. If email is not configured locally, read the latest code from otp_challenges table.')
        } catch (err) {
            log.warn('Failed to prepare OTP challenge', err)
            setError(err instanceof Error ? err.message : 'Failed to prepare OTP challenge.')
        } finally {
            setLoading(false)
        }
    }

    const submitOtp = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        try {
            await exchangeLocalOtpForToken(env, email, code)
            persistVisitId()
            onAuthenticated()
        } catch (err) {
            log.warn('Failed to exchange OTP token', err)
            setError(err instanceof Error ? err.message : 'Failed to authenticate.')
        } finally {
            setLoading(false)
        }
    }

    const submitToken = (e) => {
        e.preventDefault()
        setError(null)
        const trimmed = String(token).trim()
        if (!trimmed) {
            setError('Access token is required')
            return
        }
        setAccessToken(trimmed)
        persistVisitId()
        log.info('Remote access token stored', { env: envLabel })
        onAuthenticated()
    }

    const persistVisitId = () => {
        const trimmed = String(visitId).trim()
        setRuntimeVisitId(trimmed)
        log.info('Visit ID stored', { hasValue: Boolean(trimmed) })
    }

    if (step === 'env') {
        return (
            <div className="local-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="local-auth-title">
                <div className="local-auth-card glass">
                    <h2 id="local-auth-title">Select Environment</h2>
                    <p className="local-auth-subtitle">
                        Choose which Ankabut modulith you want this session to talk to. Your choice is saved
                        in this browser and overrides any <code>VITE_API_BACKEND</code> in <code>.env</code>.
                    </p>

                    <div className="local-auth-env-grid">
                        {ENV_OPTIONS.map((opt) => (
                            <button
                                key={opt.label}
                                type="button"
                                className="local-auth-env-card"
                                data-env={opt.label.toLowerCase()}
                                onClick={() => handlePickEnv(opt.label)}
                            >
                                <span className="local-auth-env-card-label">{opt.label}</span>
                                <span className="local-auth-env-card-desc">{opt.description}</span>
                                <span className="local-auth-env-card-url">
                                    {API_BACKENDS[BACKEND_PRESETS[opt.label]]}
                                </span>
                            </button>
                        ))}
                    </div>

                    <p className="local-auth-hint">
                        DEV / TEST require a bearer token issued for that environment. LOCAL uses the
                        built-in email + OTP flow.
                    </p>
                </div>
            </div>
        )
    }

    const title = isLocalOtp ? 'Local Sign In' : `${envLabel} Sign In`
    const subtitle = isLocalOtp
        ? 'Authenticate with email OTP to access secure chatting endpoints.'
        : `Paste a bearer access token to authenticate against the ${envLabel} modulith.`

    return (
        <div className="local-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="local-auth-title">
            <div className="local-auth-card glass">
                <div className="local-auth-env-row">
                    <span
                        className="local-auth-env-badge"
                        data-env={envLabel.toLowerCase()}
                    >
                        {envLabel}
                    </span>
                    <span className="local-auth-env-origin" title={origin || '(relative)'}>
                        {origin || '(relative /api proxy)'}
                    </span>
                    <button type="button" className="local-auth-link" onClick={handleChangeEnv} disabled={loading}>
                        Change
                    </button>
                </div>
                <h2 id="local-auth-title">{title}</h2>
                <p className="local-auth-subtitle">{subtitle}</p>

                {isLocalOtp ? (
                    otpStep === 'email' ? (
                        <form onSubmit={submitEmail} className="local-auth-form">
                            <label htmlFor="local-auth-email">Email</label>
                            <input
                                id="local-auth-email"
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="name@example.com"
                                required
                                disabled={loading}
                            />
                            <VisitIdField
                                value={visitId}
                                onChange={setVisitId}
                                disabled={loading}
                            />
                            <button type="submit" disabled={loading}>
                                {loading ? 'Preparing OTP...' : 'Send OTP'}
                            </button>
                        </form>
                    ) : (
                        <form onSubmit={submitOtp} className="local-auth-form">
                            <label htmlFor="local-auth-otp">OTP code</label>
                            <input
                                id="local-auth-otp"
                                type="text"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                placeholder="Enter OTP"
                                required
                                disabled={loading}
                            />
                            <VisitIdField
                                value={visitId}
                                onChange={setVisitId}
                                disabled={loading}
                            />
                            <div className="local-auth-actions">
                                <button type="button" className="secondary" onClick={() => setOtpStep('email')} disabled={loading}>
                                    Change email
                                </button>
                                <button type="submit" disabled={loading}>
                                    {loading ? 'Signing in...' : 'Verify & Sign In'}
                                </button>
                            </div>
                        </form>
                    )
                ) : (
                    <form onSubmit={submitToken} className="local-auth-form">
                        <label htmlFor="local-auth-token">Access token (Bearer)</label>
                        <textarea
                            id="local-auth-token"
                            value={token}
                            onChange={(e) => setToken(e.target.value)}
                            placeholder="Paste JWT, e.g. eyJhbGciOi..."
                            rows={4}
                            required
                            disabled={loading}
                            spellCheck={false}
                            autoComplete="off"
                        />
                        <VisitIdField
                            value={visitId}
                            onChange={setVisitId}
                            disabled={loading}
                        />
                        <button type="submit" disabled={loading}>
                            Save &amp; Continue
                        </button>
                        <p className="local-auth-hint">
                            Token is held in this browser only (localStorage). Use a token issued for the {envLabel} environment.
                        </p>
                    </form>
                )}

                {hint && <p className="local-auth-hint">{hint}</p>}
                {error && <p className="local-auth-error" role="alert">{error}</p>}
            </div>
        </div>
    )
}

function VisitIdField({ value, onChange, disabled }) {
    return (
        <>
            <label htmlFor="local-auth-visit-id">
                Visit ID <span className="local-auth-optional">(optional UUID)</span>
            </label>
            <input
                id="local-auth-visit-id"
                type="text"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder="e.g. e6175e50-3928-440b-a66b-a3f00366bbf7"
                maxLength={36}
                disabled={disabled}
                spellCheck={false}
                autoComplete="off"
            />
            <p className="local-auth-hint">
                Used in orchestration <code>chatContext</code> on first message. Leave blank for the default placeholder visit.
            </p>
        </>
    )
}

VisitIdField.propTypes = {
    value: PropTypes.string.isRequired,
    onChange: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
}

LocalAuthDialog.propTypes = {
    onAuthenticated: PropTypes.func.isRequired,
}
