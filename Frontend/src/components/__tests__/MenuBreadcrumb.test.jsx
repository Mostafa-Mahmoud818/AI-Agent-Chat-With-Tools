import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MenuBreadcrumb from '../MenuBreadcrumb'

describe('MenuBreadcrumb', () => {
    it('renders nothing when crumbs is missing or empty', () => {
        const { container: c1 } = render(<MenuBreadcrumb crumbs={null} />)
        expect(c1.firstChild).toBeNull()
        const { container: c2 } = render(<MenuBreadcrumb crumbs={[]} />)
        expect(c2.firstChild).toBeNull()
    })

    it('renders each crumb label and marks the last one as current (non-interactive)', () => {
        const crumbs = [
            { label: 'Menu', levelKey: 'root' },
            { label: 'Drinks', levelKey: 'cat/1' },
            { label: 'Cold', levelKey: 'sub/2' },
        ]
        render(<MenuBreadcrumb crumbs={crumbs} />)
        expect(screen.getByText('Menu').tagName).toBe('BUTTON')
        expect(screen.getByText('Drinks').tagName).toBe('BUTTON')
        const current = screen.getByText('Cold')
        expect(current.tagName).toBe('SPAN')
        expect(current).toHaveAttribute('aria-current', 'page')
    })

    it('invokes onCrumbClick with the crumb object when an ancestor is clicked', () => {
        const onCrumbClick = vi.fn()
        const crumbs = [
            { label: 'Menu', levelKey: 'root' },
            { label: 'Drinks', levelKey: 'cat/1' },
            { label: 'Cold', levelKey: 'sub/2' },
        ]
        render(<MenuBreadcrumb crumbs={crumbs} onCrumbClick={onCrumbClick} />)
        fireEvent.click(screen.getByText('Drinks'))
        expect(onCrumbClick).toHaveBeenCalledWith(crumbs[1])
    })

    it('does not render a separator after the current crumb', () => {
        const crumbs = [
            { label: 'Menu', levelKey: 'root' },
            { label: 'Drinks', levelKey: 'cat/1' },
        ]
        const { container } = render(<MenuBreadcrumb crumbs={crumbs} />)
        const seps = container.querySelectorAll('.menu-breadcrumb-sep')
        expect(seps.length).toBe(1)
    })
})
