import { useOnlineStatus } from '../hooks/useOnlineStatus'

/** What the badge says when the device reports no connection. */
export const OFFLINE_LABEL = 'Offline'

/**
 * A small "Offline" badge, shown only while the device reports no
 * connection (`useOnlineStatus` — `navigator.onLine` and its events, never
 * a network request).
 *
 * It lives **inside the bottom nav bar**, as one more flex item beside the
 * four nav buttons: nothing is covered or moved, and the nav's height is
 * unchanged whether the badge is there or not, so the cart bar and the
 * screen's min-height (both sized from `--nav-total`) never shift when the
 * signal drops. It is deliberately absent from cart/cash/promptpay along
 * with the rest of the nav — nothing may sit near the pay buttons, and
 * being offline changes nothing about a sale anyway.
 *
 * The wrapper is always rendered and is a polite live region, so a screen
 * reader announces the badge appearing rather than silently gaining an
 * element. `aria-live` rather than `role="status"`: App's order-toast
 * region already owns that role, and two of them would make "the status
 * region" ambiguous both for assistive tech and for the tests that reach
 * for the toast by role.
 */
export function OfflineIndicator() {
  const online = useOnlineStatus()

  return (
    <div className="offline-indicator" aria-live="polite">
      {/* One short word: the nav is narrow, and the full reassurance
          ("sales are still saved on this phone") is the app's whole
          premise rather than news. */}
      {!online && <span className="offline-indicator-badge">{OFFLINE_LABEL}</span>}
    </div>
  )
}
