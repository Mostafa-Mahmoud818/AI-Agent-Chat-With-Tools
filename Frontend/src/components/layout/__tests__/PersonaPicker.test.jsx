import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PERSONA_STUDENT, PERSONA_VISIT } from '../../../config/personaSession.js'
import PersonaPicker from '../PersonaPicker.jsx'

const personaMocks = vi.hoisted(() => ({
    getAvailablePersonas: vi.fn(() => [PERSONA_VISIT, PERSONA_STUDENT]),
    getActivePersona: vi.fn(() => PERSONA_VISIT),
    setActivePersona: vi.fn(),
    ensureActivePersona: vi.fn(() => PERSONA_VISIT),
}))

vi.mock('../../../config/personaSession.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        ...personaMocks,
    }
})

describe('PersonaPicker', () => {
    beforeEach(() => {
        personaMocks.getAvailablePersonas.mockReturnValue([PERSONA_VISIT, PERSONA_STUDENT])
        personaMocks.getActivePersona.mockReturnValue(PERSONA_VISIT)
        personaMocks.setActivePersona.mockReset()
    })

    it('switches persona when enabled', () => {
        const onPersonaChange = vi.fn()
        render(<PersonaPicker onPersonaChange={onPersonaChange} />)
        fireEvent.click(screen.getByRole('button', { name: /^student$/i }))
        expect(personaMocks.setActivePersona).toHaveBeenCalledWith(PERSONA_STUDENT)
        expect(onPersonaChange).toHaveBeenCalledWith(PERSONA_STUDENT)
    })

    it('does not switch persona when disabled', () => {
        const onPersonaChange = vi.fn()
        render(<PersonaPicker onPersonaChange={onPersonaChange} disabled />)
        const student = screen.getByRole('button', { name: /^student$/i })
        expect(student).toBeDisabled()
        fireEvent.click(student)
        expect(personaMocks.setActivePersona).not.toHaveBeenCalled()
        expect(onPersonaChange).not.toHaveBeenCalled()
    })
})
