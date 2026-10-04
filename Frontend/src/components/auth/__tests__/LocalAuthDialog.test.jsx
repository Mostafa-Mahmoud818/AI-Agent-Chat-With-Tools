import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import LocalAuthDialog from '../LocalAuthDialog.jsx'
import { PERSONA_SELECTION_REQUIRED, OtpAuthError } from '../../../auth/otpAccessTokenFlow.js'

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
})
