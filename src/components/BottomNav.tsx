import { NAV_SCREENS, SCREEN_TITLES, type Screen } from '../navigation'
import { OfflineIndicator } from './OfflineIndicator'

export interface BottomNavProps {
  screen: Screen
  navigate: (screen: Screen) => void
}

/**
 * Bottom navigation bar: Sell / Orders / Report / Admin, each a >= 48px
 * button. The current screen gets `aria-current="page"`.
 *
 * App renders this as a sibling of the current screen's `ErrorBoundary`,
 * outside the tap-shield wrapper (`.screen-wrap`) — a crashed screen must
 * still be navigable, and the shield that briefly blocks stray taps right
 * after a sale must never block the nav. It's omitted entirely (not merely
 * hidden) on cart/cash/promptpay — see `showsBottomNav`.
 */
export function BottomNav({ screen, navigate }: BottomNavProps) {
  return (
    <nav className="bottom-nav" aria-label="Main">
      {NAV_SCREENS.map((s) => (
        <button
          key={s}
          type="button"
          className="bottom-nav-button"
          aria-current={s === screen ? 'page' : undefined}
          onClick={() => navigate(s)}
        >
          {SCREEN_TITLES[s]}
        </button>
      ))}
      {/* The offline badge rides in the nav rather than over the screen:
          an overlay anywhere near the bottom would sit on the cart bar or
          the pay buttons. It renders nothing at all while online, and the
          nav's height is fixed either way, so nothing below it moves when
          the signal drops. */}
      <OfflineIndicator />
    </nav>
  )
}
