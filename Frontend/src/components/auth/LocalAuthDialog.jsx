import { useState } from 'react'
import PropTypes from 'prop-types'
import SparkIcon from '../ui/SparkIcon.jsx'
import { createLogger } from '../../utils/logger.js'
import {
    exchangeOtpForToken,
    prepareOtpChallenge,
} from '../../auth/otpAccessTokenFlow.js'
import { clearSecureAuthSession } from '../../auth/secureAuthSession.js'
import { getBackendEnvLabel, resolveApiOrigin, API_BACKENDS } from '../../config/apiOrigin.js'
import {
    getRuntimeBackendEnv,
    setRuntimeBackendEnv,
    BACKEND_PRESETS,
} from '../../config/runtimeSettings.js'
import {
    getRuntimeVisitId,
    getRuntimeStudentId,
    setRuntimeVisitId,
    normalizeVisitId,
} from '../../config/chatContext.js'
import {
    ensureActivePersona,
    PERSONA_STUDENT,
    PERSONA_VISIT,
    setActivePersona,
} from '../../config/personaSession.js'
import './LocalAuthDialog.css'

const log = createLogger('LocalAuthDialog')

const ENV_OPTIONS = [
    { label: 'DEV', description: 'dev-modulith.naitive.ai — email + OTP' },
    { label: 'TEST', description: 'test-modulith.naitive.ai — email + OTP' },
    { label: 'STAGE', description: 'stg-modulith.naitive.ai — email + OTP' },
    { label: 'LOCAL', description: 'localhost:8085 — email + OTP' },
]

function initialStep() {
    return getRuntimeBackendEnv() ? 'auth' : 'env'
}

function otpSentHint(envLabel) {
    if (envLabel === 'LOCAL') {
        return 'OTP sent. If email is not configured locally, read the latest code from the otp_challenges table.'
    }
    return 'OTP sent. Check your email inbox for the verification code.'
}

export default function LocalAuthDialog({ onAuthenticated }) {
    const env = import.meta.env
    const [step, setStep] = useState(initialStep)
    const [envLabel, setEnvLabel] = useState(() => getBackendEnvLabel(env))
    const [origin, setOrigin] = useState(() => resolveApiOrigin(env))

    const [otpStep, setOtpStep] = useState('email')
    const [email, setEmail] = useState(env.VITE_LOCAL_AUTH_EMAIL ?? env.VITE_AUTH_EMAIL ?? '')
    const [code, setCode] = useState('')
    const [resolvedVisitId, setResolvedVisitId] = useState(() => getRuntimeVisitId())
    const [resolvedStudentId, setResolvedStudentId] = useState(() => getRuntimeStudentId())
    const [manualVisitId, setManualVisitId] = useState('')
    const [showManualVisit, setShowManualVisit] = useState(false)
    /** When true, student resolved successfully — do not offer manual visit. */
    const [studentOnlySuccess, setStudentOnlySuccess] = useState(false)

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [hint, setHint] = useState(null)

    const handlePickEnv = (label) => {
        const previous = getRuntimeBackendEnv()
        setRuntimeBackendEnv(label)
        if (previous && previous !== label) {
            clearSecureAuthSession()
            log.info('Backend env changed — clearing stored token and context ids', { from: previous, to: label })
            window.location.reload()
            return
        }
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
            await prepareOtpChallenge(env, email)
            setOtpStep('otp')
            setHint(otpSentHint(envLabel))
        } catch (err) {
            log.warn('Failed to prepare OTP challenge', err)
            const message = err instanceof Error ? err.message : 'Failed to prepare OTP challenge.'
            if (envLabel === 'TEST' && message.includes('unexpected error')) {
                setError(
                    `${message} The test-modulith check-eligibility endpoint may be misconfigured — confirm DB migrations and ACL proxy on TEST, or ask the backend team to check server logs.`,
                )
            } else {
                setError(message)
            }
        } finally {
            setLoading(false)
        }
    }

    const submitManualVisit = (e) => {
        e.preventDefault()
        if (studentOnlySuccess) return
        const normalized = normalizeVisitId(manualVisitId)
        if (!normalized) {
            setError('Enter a valid Visit UUID.')
            return
        }
        setRuntimeVisitId(normalized)
        setResolvedVisitId(normalized)
        setActivePersona(PERSONA_VISIT)
        setShowManualVisit(false)
        setError(null)
        setHint(`Visit set manually: ${normalized}`)
        onAuthenticated({
            visitId: normalized,
            studentId: getRuntimeStudentId() || null,
            contextResolved: true,
        })
    }

    const submitOtp = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        setHint('Loading your visit and student context from the server…')
        setStudentOnlySuccess(false)
        try {
            const result = await exchangeOtpForToken(env, email, code)
            const { visitId, studentId, availablePersonas } = result
            setResolvedVisitId(visitId || '')
            setResolvedStudentId(studentId || '')
            ensureActivePersona()

            const parts = []
            if (visitId) parts.push(`Visit: ${visitId}`)
            if (studentId) parts.push(`Student: ${studentId}`)
            setHint(parts.length ? parts.join(' · ') : null)

            const onlyStudent = Boolean(studentId) && !visitId
            setStudentOnlySuccess(onlyStudent)
            if (onlyStudent) {
                setActivePersona(PERSONA_STUDENT)
            }

            onAuthenticated({
                visitId: visitId || null,
                studentId: studentId || null,
                availablePersonas: availablePersonas || [],
                contextResolved: true,
            })
        } catch (err) {
            log.warn('Failed to exchange OTP token', err)
            setError(err instanceof Error ? err.message : 'Failed to authenticate.')
            // Manual visit only when we did not already land a student-only success.
            const hasStudent = Boolean(getRuntimeStudentId())
            setShowManualVisit(!hasStudent)
            setStudentOnlySuccess(hasStudent && !getRuntimeVisitId())
            setHint(null)
        } finally {
            setLoading(false)
        }
    }

    if (step === 'env') {
        return (
            <div className="local-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="local-auth-title">
                <div className="local-auth-card glass">
                    <div className="local-auth-brand">
                        <SparkIcon size={36} withCircle />
                    </div>
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
                        All environments sign in with email + OTP. Visit and student context load automatically when available.
                    </p>
                </div>
            </div>
        )
    }

    const title = `${envLabel} Sign In`
    const subtitle =
        'Enter your email, verify the OTP, and your visit or student context loads automatically from the server.'

    return (
        <div className="local-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="local-auth-title">
                <div className="local-auth-card glass">
                <div className="local-auth-brand local-auth-brand--compact">
                    <SparkIcon size={28} withCircle />
                </div>
                <div className="local-auth-env-row">
                    <span className="local-auth-env-badge" data-env={envLabel.toLowerCase()}>
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

                {otpStep === 'email' ? (
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
                        <button type="submit" disabled={loading}>
                            {loading ? 'Preparing OTP...' : 'Send OTP'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={submitOtp} className="local-auth-form">
                        <label htmlFor="local-auth-otp">OTP code</label>
                        <input
                            id="local-auth-otp"
                            className="local-auth-otp-input"
                            type="text"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Enter OTP"
                            required
                            disabled={loading}
                        />
                        <div className="local-auth-actions">
                            <button type="button" className="secondary" onClick={() => setOtpStep('email')} disabled={loading}>
                                Change email
                            </button>
                            <button type="submit" disabled={loading}>
                                {loading ? 'Signing in…' : 'Verify & Sign In'}
                            </button>
                        </div>
                    </form>
                )}

                {resolvedVisitId && !loading && (
                    <p className="local-auth-hint">
                        Active visit id: <code>{resolvedVisitId}</code>
                    </p>
                )}
                {resolvedStudentId && !loading && (
                    <p className="local-auth-hint">
                        Active student id: <code>{resolvedStudentId}</code>
                    </p>
                )}
                {showManualVisit && !loading && !studentOnlySuccess && (
                    <form onSubmit={submitManualVisit} className="local-auth-form local-auth-manual-visit">
                        <label htmlFor="local-auth-visit-id">Visit UUID (manual fallback)</label>
                        <input
                            id="local-auth-visit-id"
                            type="text"
                            value={manualVisitId}
                            onChange={(e) => setManualVisitId(e.target.value)}
                            placeholder="550e8400-e29b-41d4-a716-446655440000"
                            spellCheck={false}
                            autoComplete="off"
                        />
                        <button type="submit">Use this Visit ID</button>
                        <p className="local-auth-hint">
                            Use when my-visits has not synced yet, or paste a known visit UUID for this environment.
                            Not needed for student-only accounts.
                        </p>
                    </form>
                )}
                {hint && <p className="local-auth-hint">{hint}</p>}
                {error && <p className="local-auth-error" role="alert">{error}</p>}
            </div>
        </div>
    )
}

LocalAuthDialog.propTypes = {
    onAuthenticated: PropTypes.func.isRequired,
}
