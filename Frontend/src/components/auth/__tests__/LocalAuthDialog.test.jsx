import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { StrictMode } from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import LocalAuthDialog from '../LocalAuthDialog.jsx'
import { PERSONA_SELECTION_REQUIRED, OtpAuthError } from '../../../auth/otpAccessTokenFlow.js'
import { clearSecureAuthSession } from '../../../auth/secureAuthSession.js'

const flowMocks = vi.hoisted(() => ({
    prepareOtpChallenge: vi.fn(),
    exchangeOtpForToken: vi.fn(),
}))

vi.mock('../../../auth/otpAccessTokenFlow.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        prepareOtpChallenge: flowMocks.prepareOtpChallenge,
        exchangeOtpForToken: flowMocks.exchangeOtpForToken,
    }
})

vi.mock('../../../auth/secureAuthSession.js', () => ({
    clearSecureAuthSession: vi.fn(),
}))

const uaePassMocks = vi.hoisted(() => ({
    takePendingUaePassSignIn: vi.fn(() => null),
    completeUaePassSignIn: vi.fn(),
    startUaePassSignIn: vi.fn(),
    wasUaePassSession: vi.fn(() => false),
    endUaePassSession: vi.fn(),
}))

vi.mock('../../../auth/uaePassFlow.js', () => uaePassMocks)

vi.mock('../../../config/apiOrigin.js', () => ({
    getBackendEnvLabel: () => 'DEV',
    resolveApiOrigin: () => 'https://dev-modulith.naitive.ai',
    API_BACKENDS: { 'remote-dev': 'https://dev-modulith.naitive.ai' },
}))

vi.mock('../../../config/runtimeSettings.js', () => ({
    getRuntimeBackendEnv: () => 'DEV',
    setRuntimeBackendEnv: vi.fn(),
    BACKEND_PRESETS: { DEV: 'remote-dev', TEST: 'remote-test', STAGE: 'remote-stage', LOCAL: 'local' },
}))

describe('LocalAuthDialog', () => {
    beforeEach(() => {
        localStorage.clear()
        flowMocks.prepareOtpChallenge.mockReset()
        flowMocks.exchangeOtpForToken.mockReset()
        flowMocks.prepareOtpChallenge.mockResolvedValue({
            eligible: true,
            personas: ['STUDENT', 'VISITOR'],
            reasons: ['STUDENT_EXISTS', 'VISITOR_EXISTS'],
        })
        flowMocks.exchangeOtpForToken.mockResolvedValue({
            visitId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
            studentId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
            availablePersonas: ['VISITOR', 'STUDENT'],
        })
    })

    it('shows a persona picker when check-eligibility returns 2+ personas', async () => {
        render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dual@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: /send otp/i }))

        expect(await screen.findByRole('radiogroup', { name: /sign in as/i })).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: /student/i })).toBeInTheDocument()
        expect(screen.getByRole('radio', { name: /visitor/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /verify & sign in/i })).toBeDisabled()
    })

    it('sends the selected personaCode on verify', async () => {
        const onAuthenticated = vi.fn()
        render(<LocalAuthDialog onAuthenticated={onAuthenticated} />)

        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dual@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: /send otp/i }))
        await screen.findByRole('radiogroup', { name: /sign in as/i })

        fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } })
        fireEvent.click(screen.getByRole('radio', { name: /student/i }))
        fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }))

        await waitFor(() => {
            expect(flowMocks.exchangeOtpForToken).toHaveBeenCalledWith(
                expect.anything(),
                'dual@example.com',
                '123456',
                'STUDENT',
            )
        })
        await waitFor(() => expect(onAuthenticated).toHaveBeenCalled())
    })

    it('does not show a picker for a single matched persona and still sends that code', async () => {
        flowMocks.prepareOtpChallenge.mockResolvedValue({
            eligible: true,
            personas: ['STUDENT'],
            reasons: ['STUDENT_EXISTS'],
        })
        render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'student@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: /send otp/i }))

        await screen.findByLabelText(/otp code/i)
        expect(screen.queryByRole('radiogroup', { name: /sign in as/i })).not.toBeInTheDocument()

        fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } })
        fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }))

        await waitFor(() => {
            expect(flowMocks.exchangeOtpForToken).toHaveBeenCalledWith(
                expect.anything(),
                'student@example.com',
                '123456',
                'STUDENT',
            )
        })
    })

    it('keeps the OTP step when the backend requires persona selection', async () => {
        flowMocks.prepareOtpChallenge.mockResolvedValue({
            eligible: true,
            personas: ['STUDENT', 'VISITOR'],
            reasons: [],
        })
        flowMocks.exchangeOtpForToken.mockRejectedValue(
            new OtpAuthError('Multiple personas matched — personaCode is required', {
                error: PERSONA_SELECTION_REQUIRED,
                status: 400,
            }),
        )
        render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'dual@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: /send otp/i }))
        await screen.findByRole('radiogroup', { name: /sign in as/i })

        fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } })
        fireEvent.click(screen.getByRole('radio', { name: /visitor/i }))
        fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }))

        expect(await screen.findByRole('alert')).toHaveTextContent(/more than one sign-in option/i)
        expect(screen.getByLabelText(/otp code/i)).toHaveValue('123456')
        expect(screen.queryByLabelText(/visit uuid/i)).not.toBeInTheDocument()
    })

    it('shows a terminal "signed in, no chat" message for a chatUnavailable persona instead of an error', async () => {
        flowMocks.prepareOtpChallenge.mockResolvedValue({
            eligible: true,
            personas: ['EMPLOYEE'],
            reasons: ['EMPLOYEE_EXISTS'],
        })
        flowMocks.exchangeOtpForToken.mockResolvedValue({
            chatUnavailable: true,
            personaCode: 'EMPLOYEE',
            availablePersonas: [],
        })
        const onAuthenticated = vi.fn()
        render(<LocalAuthDialog onAuthenticated={onAuthenticated} />)

        fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'employee@example.com' } })
        fireEvent.click(screen.getByRole('button', { name: /send otp/i }))
        await screen.findByLabelText(/otp code/i)

        fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } })
        fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }))

        expect(await screen.findByText(/signed in as employee/i)).toBeInTheDocument()
        expect(screen.getByText(/doesn.t have anything set up/i)).toBeInTheDocument()
        expect(screen.queryByRole('alert')).not.toBeInTheDocument()
        expect(onAuthenticated).not.toHaveBeenCalled()

        fireEvent.click(screen.getByRole('button', { name: /use a different account/i }))
        expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
    })

    describe('Sign in with UAE PASS', () => {
        const TOKENS = { accessToken: 'uae-jwt', refreshToken: 'r', expiresIn: 300 }

        beforeEach(() => {
            uaePassMocks.takePendingUaePassSignIn.mockReset().mockReturnValue(null)
            uaePassMocks.completeUaePassSignIn.mockReset()
            uaePassMocks.startUaePassSignIn.mockReset()
            uaePassMocks.wasUaePassSession.mockReset().mockReturnValue(false)
            uaePassMocks.endUaePassSession.mockReset()
        })

        afterEach(() => {
            vi.unstubAllEnvs()
        })

        it('starts UAE PASS from the email step', () => {
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            fireEvent.click(screen.getByRole('button', { name: /sign in with uae pass/i }))
            expect(uaePassMocks.startUaePassSignIn).toHaveBeenCalledTimes(1)
        })

        it('hides the UAE PASS button when VITE_API_BEARER_TOKEN is set', () => {
            vi.stubEnv('VITE_API_BEARER_TOKEN', 'ci-token')
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            expect(screen.queryByRole('button', { name: /sign in with uae pass/i })).not.toBeInTheDocument()
        })

        it('completes the pending sign-in exactly once under StrictMode', async () => {
            // Real take-once semantics: the promise is handed out on the first call only.
            uaePassMocks.takePendingUaePassSignIn.mockReturnValueOnce(Promise.resolve(TOKENS))
            uaePassMocks.completeUaePassSignIn.mockResolvedValue({
                accessToken: 'uae-jwt',
                visitId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                studentId: null,
                availablePersonas: ['VISITOR'],
            })
            const onAuthenticated = vi.fn()
            render(<StrictMode><LocalAuthDialog onAuthenticated={onAuthenticated} /></StrictMode>)

            await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
            expect(uaePassMocks.takePendingUaePassSignIn).toHaveBeenCalledTimes(2)
            expect(uaePassMocks.completeUaePassSignIn).toHaveBeenCalledTimes(1)
        })

        it('finishes a successful pending sign-in through onAuthenticated', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(Promise.resolve(TOKENS))
            uaePassMocks.completeUaePassSignIn.mockResolvedValue({
                accessToken: 'uae-jwt',
                visitId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                studentId: null,
                availablePersonas: ['VISITOR'],
            })
            const onAuthenticated = vi.fn()
            render(<LocalAuthDialog onAuthenticated={onAuthenticated} />)

            await waitFor(() => expect(onAuthenticated).toHaveBeenCalledWith({
                visitId: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
                studentId: null,
                availablePersonas: ['VISITOR'],
                contextResolved: true,
            }))
            expect(uaePassMocks.completeUaePassSignIn).toHaveBeenCalledWith(expect.anything(), TOKENS)
        })

        it('shows a persona picker for a persona-less token with matched personas and restarts UAE PASS with the pick', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(
                Promise.resolve({ ...TOKENS, matchedPersonas: ['STUDENT', 'VISITOR'] }),
            )
            const onAuthenticated = vi.fn()
            render(<LocalAuthDialog onAuthenticated={onAuthenticated} />)

            fireEvent.click(await screen.findByRole('button', { name: 'Student' }))
            expect(uaePassMocks.startUaePassSignIn).toHaveBeenCalledWith('STUDENT')
            expect(uaePassMocks.completeUaePassSignIn).not.toHaveBeenCalled()
            expect(onAuthenticated).not.toHaveBeenCalled()
        })

        it('returns to the email step when the UAE PASS persona choice is cancelled', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(
                Promise.resolve({ ...TOKENS, matchedPersonas: ['STUDENT', 'VISITOR'] }),
            )
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))
            expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
            expect(screen.queryByRole('button', { name: 'Visitor' })).not.toBeInTheDocument()
            expect(uaePassMocks.startUaePassSignIn).not.toHaveBeenCalled()
        })

        it('shows the signed-in card for a chatUnavailable result without a persona', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(Promise.resolve(TOKENS))
            uaePassMocks.completeUaePassSignIn.mockResolvedValue({
                chatUnavailable: true,
                personaCode: null,
                availablePersonas: [],
            })
            const onAuthenticated = vi.fn()
            render(<LocalAuthDialog onAuthenticated={onAuthenticated} />)

            expect(await screen.findByRole('heading', { name: /signed in/i })).toBeInTheDocument()
            expect(screen.getByText(/signed in as this account/i)).toBeInTheDocument()
            expect(screen.queryByRole('alert')).not.toBeInTheDocument()
            expect(onAuthenticated).not.toHaveBeenCalled()
        })

        it('offers the manual visit field when context resolution fails after the token is stored', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(Promise.resolve(TOKENS))
            uaePassMocks.completeUaePassSignIn.mockRejectedValue(
                new Error("We couldn't find your visit or student details yet."),
            )
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            expect(await screen.findByLabelText(/visit uuid/i)).toBeInTheDocument()
            expect(screen.getByRole('alert')).toHaveTextContent(/couldn't find your visit/i)
        })

        it('shows the message and no manual visit field when the pending sign-in is rejected', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(
                Promise.reject(new Error('User cancelled the login.')),
            )
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            expect(await screen.findByRole('alert')).toHaveTextContent('User cancelled the login.')
            expect(screen.queryByLabelText(/visit uuid/i)).not.toBeInTheDocument()
            expect(screen.queryByText(/completing uae pass sign-in/i)).not.toBeInTheDocument()
            expect(uaePassMocks.completeUaePassSignIn).not.toHaveBeenCalled()
        })

        it('hides the email step while completing and restores it after a rejection', async () => {
            let reject
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(new Promise((_, rej) => {
                reject = rej
            }))
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            expect(screen.getByText(/completing uae pass sign-in/i)).toBeInTheDocument()
            expect(screen.queryByLabelText(/email/i)).not.toBeInTheDocument()
            expect(screen.queryByRole('button', { name: /send otp/i })).not.toBeInTheDocument()
            expect(screen.queryByRole('button', { name: /sign in with uae pass/i })).not.toBeInTheDocument()
            expect(screen.queryByText('or')).not.toBeInTheDocument()

            await act(async () => {
                reject(new Error('User cancelled the login.'))
            })

            expect(await screen.findByLabelText(/email/i)).toBeInTheDocument()
            expect(screen.getByRole('button', { name: /sign in with uae pass/i })).toBeInTheDocument()
            expect(screen.queryByText(/completing uae pass sign-in/i)).not.toBeInTheDocument()
        })

        it('calls endUaePassSession on "Use a different account" when the session was UAE PASS', async () => {
            uaePassMocks.takePendingUaePassSignIn.mockReturnValue(Promise.resolve(TOKENS))
            uaePassMocks.completeUaePassSignIn.mockResolvedValue({ chatUnavailable: true, personaCode: null, availablePersonas: [] })
            uaePassMocks.wasUaePassSession.mockReturnValue(true)
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            fireEvent.click(await screen.findByRole('button', { name: /use a different account/i }))
            expect(uaePassMocks.endUaePassSession).toHaveBeenCalledTimes(1)
            // The marker is read before clearSecureAuthSession removes it; the redirect comes last.
            const clearOrder = vi.mocked(clearSecureAuthSession).mock.invocationCallOrder.at(-1)
            expect(uaePassMocks.wasUaePassSession.mock.invocationCallOrder.at(-1)).toBeLessThan(clearOrder)
            expect(uaePassMocks.endUaePassSession.mock.invocationCallOrder.at(-1)).toBeGreaterThan(clearOrder)
        })

        it('does not call endUaePassSession on "Use a different account" for an OTP session', async () => {
            flowMocks.prepareOtpChallenge.mockResolvedValue({
                eligible: true,
                personas: ['EMPLOYEE'],
                reasons: ['EMPLOYEE_EXISTS'],
            })
            flowMocks.exchangeOtpForToken.mockResolvedValue({
                chatUnavailable: true,
                personaCode: 'EMPLOYEE',
                availablePersonas: [],
            })
            render(<LocalAuthDialog onAuthenticated={vi.fn()} />)

            fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'employee@example.com' } })
            fireEvent.click(screen.getByRole('button', { name: /send otp/i }))
            await screen.findByLabelText(/otp code/i)
            fireEvent.change(screen.getByLabelText(/otp code/i), { target: { value: '123456' } })
            fireEvent.click(screen.getByRole('button', { name: /verify & sign in/i }))

            fireEvent.click(await screen.findByRole('button', { name: /use a different account/i }))
            expect(uaePassMocks.endUaePassSession).not.toHaveBeenCalled()
        })
    })
})
