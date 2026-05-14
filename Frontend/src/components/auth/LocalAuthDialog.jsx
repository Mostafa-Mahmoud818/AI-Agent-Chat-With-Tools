import { useState } from 'react'
import PropTypes from 'prop-types'
import { createLogger } from '../../utils/logger.js'
import { exchangeLocalOtpForToken, prepareLocalOtpChallenge } from '../../auth/localAccessTokenFlow.js'
import './LocalAuthDialog.css'

const log = createLogger('LocalAuthDialog')

export default function LocalAuthDialog({ onAuthenticated }) {
    const [step, setStep] = useState('email')
    const [email, setEmail] = useState(import.meta.env.VITE_LOCAL_AUTH_EMAIL ?? '')
    const [code, setCode] = useState('')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [hint, setHint] = useState(null)

    const submitEmail = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError(null)
        setHint(null)
        try {
            await prepareLocalOtpChallenge(import.meta.env, email)
            setStep('otp')
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
            await exchangeLocalOtpForToken(import.meta.env, email, code)
            onAuthenticated()
        } catch (err) {
            log.warn('Failed to exchange OTP token', err)
            setError(err instanceof Error ? err.message : 'Failed to authenticate.')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div className="local-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="local-auth-title">
            <div className="local-auth-card glass">
                <h2 id="local-auth-title">Local Sign In</h2>
                <p className="local-auth-subtitle">
                    Authenticate with email OTP to access secure chatting endpoints.
                </p>

                {step === 'email' ? (
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
                            type="text"
                            value={code}
                            onChange={(e) => setCode(e.target.value)}
                            placeholder="Enter OTP"
                            required
                            disabled={loading}
                        />
                        <div className="local-auth-actions">
                            <button type="button" className="secondary" onClick={() => setStep('email')} disabled={loading}>
                                Change email
                            </button>
                            <button type="submit" disabled={loading}>
                                {loading ? 'Signing in...' : 'Verify & Sign In'}
                            </button>
                        </div>
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
