import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import RequestTypeCards, { isRenderableIcon, resolveRequestTypesLang } from '../chat/RequestTypeCards.jsx'
import * as api from '../../services/api.js'
import { getAccessToken } from '../../auth/tokenStore.js'

vi.mock('../../services/api.js', () => ({
    getRequestTypes: vi.fn(),
}))

vi.mock('../../auth/tokenStore.js', () => ({
    getAccessToken: vi.fn(),
}))

/** Unsigned JWT carrying the given persona_code claim. */
function tokenFor(personaCode) {
    const payload = btoa(JSON.stringify({ sub: 'u', persona_code: personaCode }))
        .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
    return `e30.${payload}.sig`
}

const SVG_ICON = `data:image/svg+xml;base64,${btoa('<svg xmlns="http://www.w3.org/2000/svg"></svg>')}`

const STUDENT_TYPES = [
    { key: 'student_absence', label: 'Absence Request', templatePrompt: 'I need to report an absence', icon: SVG_ICON },
    { key: 'banner_error', label: 'Report Error', templatePrompt: 'I want to report an error', icon: SVG_ICON },
]

describe('RequestTypeCards', () => {
    beforeEach(() => {
        vi.mocked(api.getRequestTypes).mockReset()
        vi.mocked(getAccessToken).mockReset()
    })

    it('renders one card per backend request type and sends its template prompt on click', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockResolvedValue(STUDENT_TYPES)
        const onSelect = vi.fn()

        render(<RequestTypeCards persona="STUDENT" onSelect={onSelect} />)

        expect(await screen.findByText('What are you looking for?')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Absence Request/i })).toBeInTheDocument()
        await userEvent.click(screen.getByRole('button', { name: /Report Error/i }))
        expect(onSelect).toHaveBeenCalledWith(STUDENT_TYPES[1])
    })

    it('does not call the backend when the active persona differs from the JWT persona', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))

        const { container } = render(<RequestTypeCards persona="VISITOR" onSelect={vi.fn()} />)

        await waitFor(() => expect(container).toBeEmptyDOMElement())
        expect(api.getRequestTypes).not.toHaveBeenCalled()
    })

    it('does not call the backend when the token has no persona_code', async () => {
        vi.mocked(getAccessToken).mockReturnValue('not-a-jwt')

        const { container } = render(<RequestTypeCards persona="STUDENT" onSelect={vi.fn()} />)

        await waitFor(() => expect(container).toBeEmptyDOMElement())
        expect(api.getRequestTypes).not.toHaveBeenCalled()
    })

    it('renders nothing when the backend call fails', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockRejectedValueOnce(new Error('boom'))

        const { container } = render(<RequestTypeCards persona="STUDENT" onSelect={vi.fn()} />)

        await waitFor(() => expect(api.getRequestTypes).toHaveBeenCalled())
        expect(container).toBeEmptyDOMElement()
    })

    it('renders nothing when the backend returns no request types', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockResolvedValueOnce([])

        const { container } = render(<RequestTypeCards persona="STUDENT" onSelect={vi.fn()} />)

        await waitFor(() => expect(api.getRequestTypes).toHaveBeenCalled())
        expect(container).toBeEmptyDOMElement()
    })

    it('disables the cards while a send is in flight', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockResolvedValue(STUDENT_TYPES)

        render(<RequestTypeCards persona="STUDENT" disabled onSelect={vi.fn()} />)

        expect(await screen.findByRole('button', { name: /Absence Request/i })).toBeDisabled()
    })

    it('renders the server-sent icon as an image on each card', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockResolvedValue(STUDENT_TYPES)

        render(<RequestTypeCards persona="STUDENT" onSelect={vi.fn()} />)

        const card = await screen.findByRole('button', { name: /Absence Request/i })
        const img = card.querySelector('img')
        expect(img).not.toBeNull()
        expect(img.getAttribute('src')).toBe(SVG_ICON)
        expect(img.getAttribute('alt')).toBe('')
    })

    it('falls back to a built-in icon when the server icon is missing or not an image data URI', async () => {
        vi.mocked(getAccessToken).mockReturnValue(tokenFor('STUDENT'))
        vi.mocked(api.getRequestTypes).mockResolvedValue([
            { key: 'student_absence', label: 'Absence Request', templatePrompt: 'p' },
            { key: 'banner_error', label: 'Report Error', templatePrompt: 'p', icon: 'javascript:alert(1)' },
        ])

        render(<RequestTypeCards persona="STUDENT" onSelect={vi.fn()} />)

        for (const name of [/Absence Request/i, /Report Error/i]) {
            const card = await screen.findByRole('button', { name })
            expect(card.querySelector('img')).toBeNull()
            expect(card.querySelector('svg')).not.toBeNull()
        }
    })

    it('accepts only base64 image data URIs as icons', () => {
        expect(isRenderableIcon(SVG_ICON)).toBe(true)
        expect(isRenderableIcon('data:image/png;base64,AAAA')).toBe(true)
        expect(isRenderableIcon('data:text/html;base64,AAAA')).toBe(false)
        expect(isRenderableIcon('https://example.com/icon.svg')).toBe(false)
        expect(isRenderableIcon(null)).toBe(false)
    })

    it('asks for Arabic only when the browser language is Arabic', () => {
        const spy = vi.spyOn(navigator, 'language', 'get')
        spy.mockReturnValue('ar-AE')
        expect(resolveRequestTypesLang()).toBe('ar')
        spy.mockReturnValue('en-US')
        expect(resolveRequestTypesLang()).toBe('en')
        spy.mockRestore()
    })
})
