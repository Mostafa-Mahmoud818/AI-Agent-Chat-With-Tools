import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SignOutButton from '../layout/SignOutButton.jsx'
import { getLockedPersona } from '../../config/personaSession.js'

vi.mock('../../config/personaSession.js', async (importOriginal) => ({
    ...(await importOriginal()),
    getLockedPersona: vi.fn(() => null),
}))

describe('SignOutButton', () => {
    beforeEach(() => {
        vi.mocked(getLockedPersona).mockReturnValue(null)
    })

    it('calls onSignOut when clicked', () => {
        const onSignOut = vi.fn()
        render(<SignOutButton onSignOut={onSignOut} />)

        fireEvent.click(screen.getByRole('button', { name: /Sign out/i }))

        expect(onSignOut).toHaveBeenCalledTimes(1)
    })

    it('explains that switching persona needs a new sign-in', () => {
        vi.mocked(getLockedPersona).mockReturnValue('STUDENT')
        render(<SignOutButton onSignOut={vi.fn()} />)

        expect(screen.getByRole('button', { name: /Sign out/i })).toHaveAttribute(
            'title',
            'Signed in as Student. Sign out to use a different persona.',
        )
    })

    it('is disabled while a chat round is in flight', () => {
        const onSignOut = vi.fn()
        render(<SignOutButton onSignOut={onSignOut} disabled />)

        const button = screen.getByRole('button', { name: /Sign out/i })
        expect(button).toBeDisabled()
        fireEvent.click(button)
        expect(onSignOut).not.toHaveBeenCalled()
    })
})
