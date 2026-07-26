import { memo, useEffect, useState } from 'react'
import PropTypes from 'prop-types'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import SparkIcon from '../ui/SparkIcon.jsx'
import MenuBreadcrumb from '../navigation/MenuBreadcrumb.jsx'
import './MessageBubble.css'

const MENU_PAGE_SIZE = 6
const EMPTY_MENU_COPY = 'No items are currently available. Please try again later or contact support.'
const MENU_ERROR_COPY = 'Something went wrong while loading the menu. Please try again or contact support if the issue persists.'

/** BRD NFR-05: zero price shown as $0.0 (not $0.00); other prices use two decimals with currency prefix. */
function formatMenuItemPriceDisplay(price) {
    if (price == null) return null
    const n = Number(price)
    if (Number.isNaN(n)) return String(price)
    if (n === 0) return '$0.0'
    return `$${n.toFixed(2)}`
}

function stripThinkingTags(text) {
    if (!text) return text
    return text.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim()
}

const markdownComponents = {
    a: ({ node, ...props }) => (
        <a {...props} target="_blank" rel="noopener noreferrer" />
    ),
}

function MenuItems({ items, onItemClick }) {
    const [page, setPage] = useState(0)
    const totalPages = Math.max(1, Math.ceil(items.length / MENU_PAGE_SIZE))

    // Reset to first page whenever the items reference changes (new agent turn).
    useEffect(() => {
        setPage(0)
    }, [items])

    const safePage = Math.min(page, totalPages - 1)
    const start = safePage * MENU_PAGE_SIZE
    const pageItems = items.slice(start, start + MENU_PAGE_SIZE)
    const showPager = items.length > MENU_PAGE_SIZE

    return (
        <div className="menu-items-container">
            <div className="menu-items-grid">
                {pageItems.map(item => {
                    const isProduct = item.code != null
                    return (
                        <button
                            key={item.id}
                            className={`menu-card${isProduct ? ' product' : ''}`}
                            onClick={() => onItemClick?.(item)}
                            title={`Select ${item.label}`}
                        >
                            <div className="menu-card-header">
                                <span className="menu-card-label">{item.label}</span>
                                {isProduct && (
                                    <span className="menu-card-code">#{item.code}</span>
                                )}
                                {item.price != null && (
                                    <span className="menu-card-price">
                                        {isProduct ? formatMenuItemPriceDisplay(item.price) : `$${Number(item.price).toFixed(2)}`}
                                    </span>
                                )}
                            </div>
                            {!isProduct && item.description && (
                                <span className="menu-card-desc">{item.description}</span>
                            )}
                        </button>
                    )
                })}
            </div>
            {showPager && (
                <div className="menu-pagination" role="navigation" aria-label="Menu pagination">
                    <button
                        type="button"
                        className="menu-pager-btn"
                        onClick={() => setPage(p => Math.max(0, p - 1))}
                        disabled={safePage === 0}
                        aria-label="Previous page"
                    >
                        ‹ Previous
                    </button>
                    <span className="menu-pager-info" aria-live="polite">
                        Page {safePage + 1} of {totalPages}
                    </span>
                    <button
                        type="button"
                        className="menu-pager-btn"
                        onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                        disabled={safePage === totalPages - 1}
                        aria-label="Next page"
                    >
                        Next ›
                    </button>
                </div>
            )}
        </div>
    )
}

function resolveMenuItems(payload) {
    if (!payload || typeof payload !== 'object') return []
    if (Array.isArray(payload.menuitems)) return payload.menuitems
    if (Array.isArray(payload.items)) return payload.items
    return []
}

// Internal identifiers (UUIDs) must never be rendered to the user; user-facing
// reference codes (e.g. IT-2026-00042) are the only identifiers allowed on screen.
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/

function OrderConfirmationCard({ payload }) {
    // Schema: payload.order holds the nested order object.
    // Fall back to reading fields directly from payload for any legacy flat structure.
    const order = payload.order ?? null
    const referenceCode = order?.referenceCode ?? payload.referenceCode             ?? null
    const rawOrderId    = order?.id           ?? payload.orderId    ?? payload.id    ?? null
    const customerName  = order?.customerName ?? payload.customerName                ?? null
    const status        = order?.status       ?? payload.status                      ?? null
    const totalPrice    = order?.totalPrice   ?? payload.totalPrice                  ?? null
    const createdAt     = order?.createdAt    ?? payload.createdAt                   ?? null
    const items = Array.isArray(order?.items) ? order.items
                : Array.isArray(payload.items) ? payload.items : []

    // Prefer the user-facing reference code; never show a UUID-shaped internal id.
    const orderRef = referenceCode
        ?? (rawOrderId && !UUID_RE.test(String(rawOrderId)) ? rawOrderId : null)

    const hasMeta = orderRef || customerName || status || totalPrice != null || createdAt
    return (
        <div className="order-confirmation-card">
            <div className="order-confirmation-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
                <span>Order Confirmed</span>
            </div>
            {hasMeta && (
                <div className="order-confirmation-meta">
                    {orderRef && (
                        <span className="order-meta-item">
                            <span className="order-meta-label">Reference</span>
                            <span className="order-meta-value">{String(orderRef)}</span>
                        </span>
                    )}
                    {customerName && (
                        <span className="order-meta-item">
                            <span className="order-meta-label">Customer</span>
                            <span className="order-meta-value">{String(customerName)}</span>
                        </span>
                    )}
                    {status && (
                        <span className="order-meta-item">
                            <span className="order-meta-label">Status</span>
                            <span className="order-meta-value order-status">{String(status)}</span>
                        </span>
                    )}
                    {totalPrice != null && (
                        <span className="order-meta-item">
                            <span className="order-meta-label">Total</span>
                            <span className="order-meta-value order-total">
                                ${Number(totalPrice).toFixed(2)}
                            </span>
                        </span>
                    )}
                    {createdAt && (
                        <span className="order-meta-item">
                            <span className="order-meta-label">Placed</span>
                            <span className="order-meta-value order-date">
                                {new Date(createdAt).toLocaleString()}
                            </span>
                        </span>
                    )}
                </div>
            )}
            {items.length > 0 && (
                <div className="order-confirmation-items">
                    {items.map((item, idx) => {
                        const name = item.productNameAtTimeOfOrder
                            ?? item.productName ?? item.label ?? item.name
                            ?? item.productId ?? `Item ${idx + 1}`
                        const qty       = item.quantity   ?? item.qty       ?? null
                        const itemTotal = item.itemTotalPrice ?? item.totalPrice ?? null
                        return (
                            <div key={item.id ?? item.productId ?? idx} className="order-item-row">
                                <span className="order-item-name">{String(name)}</span>
                                <span className="order-item-right">
                                    {qty != null && <span className="order-item-qty">×{qty}</span>}
                                    {itemTotal != null && (
                                        <span className="order-item-total">
                                            ${Number(itemTotal).toFixed(2)}
                                        </span>
                                    )}
                                </span>
                            </div>
                        )
                    })}
                </div>
            )}
        </div>
    )
}

function TicketCard({ payload }) {
    // Security: payload.ticketId is an internal UUID kept for machine use only — never rendered.
    // The user-facing referenceCode (e.g. IT-2026-00042) is shown on the card; it also appears in
    // the message text. Guard against a UUID-shaped value just like the order card does.
    const ticketStatus = payload.ticketStatus ?? null
    const rawRef = payload.referenceCode ?? null
    const ticketRef = rawRef && !UUID_RE.test(String(rawRef)) ? rawRef : null
    const hasMeta = ticketRef || ticketStatus
    return (
        <div className="ticket-card">
            <div className="ticket-card-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 13a19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 3.6 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
                <span>Support Ticket Created</span>
            </div>
            {hasMeta && (
                <div className="ticket-card-meta">
                    {ticketRef && <span className="ticket-meta-item"><span className="ticket-meta-label">Reference</span><span className="ticket-meta-value">{String(ticketRef)}</span></span>}
                    {ticketStatus && <span className="ticket-meta-item"><span className="ticket-meta-label">Status</span><span className="ticket-meta-value ticket-status">{String(ticketStatus)}</span></span>}
                </div>
            )}
        </div>
    )
}

function NavigationCard({ navigation, outdoor }) {
    if (!navigation || typeof navigation !== 'object') return null
    // Security: navigation.resourceId stays in the payload for the app's wayfinding — never rendered.
    const { locationName, resourceName, latitude, longitude } = navigation
    const isOutdoor = outdoor
    const hasCoords = Number.isFinite(latitude) && Number.isFinite(longitude)
    const mapsUrl = hasCoords
        ? `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`
        : null
    const title = resourceName || locationName || 'Destination'
    const showSub = locationName && locationName !== title

    return (
        <div className={`navigation-card ${isOutdoor ? 'outdoor' : 'indoor'}`}>
            <div className="navigation-card-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                    <circle cx="12" cy="10" r="3" />
                </svg>
                <span>{isOutdoor ? 'Outdoor Navigation' : 'Indoor Navigation'}</span>
            </div>
            <div className="navigation-card-body">
                <span className="navigation-card-title">{title}</span>
                {showSub && <span className="navigation-card-sub">{locationName}</span>}
                {isOutdoor && hasCoords && (
                    <span className="navigation-card-coords">{latitude}, {longitude}</span>
                )}
            </div>
            {isOutdoor && mapsUrl && (
                <a
                    className="navigation-card-action"
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                >
                    Open in Maps
                </a>
            )}
        </div>
    )
}

const VISITS_EMPTY_COPY = 'No meetings or visits found for this period.'

function formatScopeLabel(scope) {
    if (!scope) return null
    const s = String(scope).trim().toLowerCase()
    if (!s) return null
    return s.charAt(0).toUpperCase() + s.slice(1)
}

function formatStatusLabel(status) {
    if (!status) return null
    return String(status).replace(/_/g, ' ')
}

function VisitsQueryCard({ visits }) {
    if (!visits || typeof visits !== 'object') return null
    const items = Array.isArray(visits.items) ? visits.items : []
    const scopeLabel = formatScopeLabel(visits.scope)
    const totalCount = typeof visits.totalCount === 'number' ? visits.totalCount : items.length
    const showPagerHint = totalCount > items.length

    return (
        <div className="visits-query-card">
            <div className="visits-query-header">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>Meetings &amp; Visits</span>
                {scopeLabel && <span className="visits-query-scope">{scopeLabel}</span>}
            </div>
            {visits.timezone && (
                <div className="visits-query-tz">Times in {visits.timezone}</div>
            )}
            {items.length === 0 ? (
                <div className="visits-query-empty" role="status">{VISITS_EMPTY_COPY}</div>
            ) : (
                <ul className="visits-query-list">
                    {items.map((item, idx) => (
                        <li key={`${item.title}-${idx}`} className="visits-query-item">
                            <div className="visits-query-item-top">
                                <span className="visits-query-title">{item.title}</span>
                                {item.status && (
                                    <span className={`visits-query-status status-${String(item.status).toLowerCase()}`}>
                                        {formatStatusLabel(item.status)}
                                    </span>
                                )}
                            </div>
                            {item.timeDisplay && (
                                <span className="visits-query-time">{item.timeDisplay}</span>
                            )}
                            {item.hostName && (
                                <span className="visits-query-meta">Host: {item.hostName}</span>
                            )}
                            {(item.resourceName || item.locationName) && (
                                <span className="visits-query-meta">
                                    {[item.resourceName, item.locationName].filter(Boolean).join(' · ')}
                                </span>
                            )}
                            {item.floorName && (
                                <span className="visits-query-meta">{item.floorName}</span>
                            )}
                        </li>
                    ))}
                </ul>
            )}
            {showPagerHint && (
                <div className="visits-query-pager-hint" role="status">
                    Showing {items.length} of {totalCount}
                </div>
            )}
        </div>
    )
}

function formatHandledBy(value) {
    if (!value) return null
    const trimmed = String(value).trim()
    const normalized = trimmed.toUpperCase()
    // Persisted TurnDto enum names
    if (normalized === 'IT_SUPPORT') return 'IT Support'
    if (normalized === 'CATERING') return 'Catering'
    if (normalized === 'FACILITIES_MAINTENANCE') return 'Facilities & Maintenance'
    if (normalized === 'VISITOR_EXPERIENCE') return 'Assistant'
    if (normalized === 'ERROR') return 'Error'
    // SSE labels from backend (AgentVariableSupport) — shorten for UI consistency with history
    if (normalized === 'VISITOR EXPERIENCE AGENT') return 'Assistant'
    if (normalized === 'IT SUPPORT AGENT') return 'IT Support'
    if (normalized === 'CATERING AGENT') return 'Catering'
    if (normalized === 'FACILITIES & MAINTENANCE AGENT') return 'Facilities & Maintenance'
    return trimmed.replace(/_/g, ' ')
}

function MessageBubble({ message, onMenuItemClick, onBreadcrumbClick }) {
    const isAI = message.role === 'ai'
    const isSystem = message.role === 'system'
    const subtype = isAI ? message.payload?.subtype : null
    const menuItems = isAI ? resolveMenuItems(message.payload) : []
    const isMenuSubtype = isAI && subtype === 'menu'
    const hasMenu = isMenuSubtype && menuItems.length > 0
    const isEmptyMenu = isMenuSubtype && menuItems.length === 0
    const crumbs = isMenuSubtype ? message.payload?.breadcrumb : null
    const hasBreadcrumb = Array.isArray(crumbs) && crumbs.length > 0
    const isErrorPayload = isAI && subtype === 'error'
    const hasOrderConfirmation = isAI && subtype === 'order_confirmation'
    const hasTicket = isAI && subtype === 'ticket'
    const isOutdoorNav = isAI && subtype === 'outdoor_navigation'
    const hasNavigation = isOutdoorNav || (isAI && subtype === 'indoor_navigation')
    const hasVisitsQuery = isAI && subtype === 'visits_query' // legacy history only (backend flag removed)
    // System-origin (turnKind === SYSTEM) is a STRUCTURAL flag from turnsToMessages — it drives the
    // notification layout (centered, no avatar, no "Answered by"). The status update itself renders as
    // the message sentence (textString); no separate card, to avoid duplicating the same info.
    const systemOrigin = isAI && message.system === true
    const handledByLabel = formatHandledBy(message.handledBy)

    if (isSystem) {
        return (
            <div className="message-row system" role="status" aria-live="polite">
                <div className="message-bubble system-bubble">
                    <div className="message-text">{message.text}</div>
                </div>
            </div>
        )
    }

    const displayText = isAI
        ? stripThinkingTags(message.text)
        : (message.displayText || message.text)

    return (
        <div className={`message-row ${isAI ? 'ai' : 'user'}${systemOrigin ? ' system-turn' : ''}`} role="listitem"
             aria-label={systemOrigin ? 'Status update' : isAI ? 'AI response' : 'Your message'}>
            {isAI && !systemOrigin && (
                <div className="msg-avatar" aria-hidden="true">
                    <SparkIcon size={14} />
                </div>
            )}
            <div className="message-content">
                <div className={`message-bubble ${isAI ? 'ai-bubble' : 'user-bubble'}`}>
                    {isAI ? (
                        isErrorPayload ? (
                            <div className="menu-error" role="alert">{MENU_ERROR_COPY}</div>
                        ) : (
                            <div className="message-text markdown-body">
                                <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                                    {displayText}
                                </ReactMarkdown>
                            </div>
                        )
                    ) : (
                        <div className="message-text">{displayText}</div>
                    )}
                    {hasBreadcrumb && (
                        <MenuBreadcrumb crumbs={crumbs} onCrumbClick={onBreadcrumbClick} />
                    )}
                    {hasMenu && (
                        <MenuItems
                            items={menuItems}
                            onItemClick={(item) => onMenuItemClick?.(item, message.handledBy)}
                        />
                    )}
                    {isEmptyMenu && (
                        <div className="menu-empty" role="status">{EMPTY_MENU_COPY}</div>
                    )}
                    {hasOrderConfirmation && (
                        <OrderConfirmationCard payload={message.payload} />
                    )}
                    {hasTicket && (
                        <TicketCard payload={message.payload} />
                    )}
                    {hasNavigation && (
                        <NavigationCard navigation={message.payload?.navigation} outdoor={isOutdoorNav} />
                    )}
                    {hasVisitsQuery && (
                        <VisitsQueryCard visits={message.payload?.visits} />
                    )}
                </div>
                {isAI && !systemOrigin && handledByLabel && (
                    <span className="handled-by">Answered by {handledByLabel}</span>
                )}
            </div>
        </div>
    )
}

MessageBubble.propTypes = {
    message: PropTypes.shape({
        id: PropTypes.oneOfType([PropTypes.string, PropTypes.number]).isRequired,
        role: PropTypes.oneOf(['user', 'ai', 'system']).isRequired,
        system: PropTypes.bool,
        text: PropTypes.string.isRequired,
        handledBy: PropTypes.string,
        timestamp: PropTypes.instanceOf(Date),
        payload: PropTypes.shape({
            subtype: PropTypes.oneOf(['menu', 'order_confirmation', 'ticket', 'indoor_navigation', 'outdoor_navigation', 'visits_query', 'none', 'error']),
            menuitems: PropTypes.array,
            visits: PropTypes.shape({
                scope: PropTypes.string,
                defaultApplied: PropTypes.bool,
                timezone: PropTypes.string,
                totalCount: PropTypes.number,
                page: PropTypes.number,
                size: PropTypes.number,
                items: PropTypes.arrayOf(PropTypes.shape({
                    title: PropTypes.string,
                    status: PropTypes.string,
                    timeDisplay: PropTypes.string,
                    hostName: PropTypes.string,
                    resourceName: PropTypes.string,
                    locationName: PropTypes.string,
                    floorName: PropTypes.string,
                })),
            }),
            // Visitor Experience navigation card — shared contract (indoor/outdoor encoded by subtype)
            navigation: PropTypes.shape({
                locationName: PropTypes.string,
                resourceId: PropTypes.string,
                resourceName: PropTypes.string,
                latitude: PropTypes.number,
                longitude: PropTypes.number,
            }),
            items: PropTypes.array,
            breadcrumb: PropTypes.arrayOf(PropTypes.shape({
                label: PropTypes.string.isRequired,
                levelKey: PropTypes.string.isRequired,
            })),
            ticketId: PropTypes.string,
            ticketStatus: PropTypes.string,
            referenceCode: PropTypes.string,
            // Catering order_confirmation — nested order object per agent schema
            order: PropTypes.shape({
                id: PropTypes.string,
                referenceCode: PropTypes.string,
                customerName: PropTypes.string,
                status: PropTypes.string,
                totalPrice: PropTypes.number,
                createdAt: PropTypes.string,
                items: PropTypes.arrayOf(PropTypes.shape({
                    id: PropTypes.string,
                    productNameAtTimeOfOrder: PropTypes.string,
                    quantity: PropTypes.number,
                    itemTotalPrice: PropTypes.number,
                })),
            }),
        }),
    }).isRequired,
    /** Called with (item, handledBy) when a card is clicked; handledBy is message.handledBy for route-specific menu prefixes. */
    onMenuItemClick: PropTypes.func,
    /** Called with the crumb object ({label, levelKey}) when a breadcrumb ancestor is clicked. */
    onBreadcrumbClick: PropTypes.func,
}

export default memo(MessageBubble)
