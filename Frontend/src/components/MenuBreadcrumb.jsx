import PropTypes from 'prop-types'
import './MenuBreadcrumb.css'

/**
 * Breadcrumb bar rendered above a menu card (BRD: Menu navigation — breadcrumb).
 *
 * Crumbs come verbatim from `payload.breadcrumb` emitted by the agent; each entry is
 * `{ label, levelKey }`. The last crumb is the current level (non-interactive). Prior
 * crumbs are buttons — clicking one asks the host to replay the cached level in place.
 */
export default function MenuBreadcrumb({ crumbs, onCrumbClick }) {
    if (!Array.isArray(crumbs) || crumbs.length === 0) return null

    return (
        <nav className="menu-breadcrumb" aria-label="Menu breadcrumb">
            <ol className="menu-breadcrumb-list">
                {crumbs.map((crumb, idx) => {
                    const isCurrent = idx === crumbs.length - 1
                    const key = `${crumb.levelKey ?? 'lvl'}-${idx}`
                    return (
                        <li key={key} className="menu-breadcrumb-item">
                            {isCurrent ? (
                                <span
                                    className="menu-breadcrumb-current"
                                    aria-current="page"
                                >
                                    {crumb.label}
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    className="menu-breadcrumb-link"
                                    onClick={() => onCrumbClick?.(crumb)}
                                    title={`Back to ${crumb.label}`}
                                >
                                    {crumb.label}
                                </button>
                            )}
                            {!isCurrent && (
                                <span className="menu-breadcrumb-sep" aria-hidden="true">
                                    ›
                                </span>
                            )}
                        </li>
                    )
                })}
            </ol>
        </nav>
    )
}

MenuBreadcrumb.propTypes = {
    crumbs: PropTypes.arrayOf(
        PropTypes.shape({
            label: PropTypes.string.isRequired,
            levelKey: PropTypes.string.isRequired,
        }),
    ),
    onCrumbClick: PropTypes.func,
}
