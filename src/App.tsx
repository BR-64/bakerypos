import { useCallback, useEffect, useState, type ReactNode, type SyntheticEvent } from 'react'
import { BottomNav } from './components/BottomNav'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OrderToast } from './components/OrderToast'
import { db, type PosDatabase } from './db/db'
import { seedIfEmpty } from './db/seed'
import type { Order } from './domain/types'
import { useCart } from './hooks/useCart'
import { useSettings } from './hooks/useSettings'
import { useTapShield } from './hooks/useTapShield'
import {
  HOME_SCREEN,
  SCREEN_TITLES,
  showsBottomNav,
  type Screen,
  type ScreenProps,
} from './navigation'
import { CartScreen } from './screens/CartScreen'
import { CashScreen } from './screens/CashScreen'
import { OrdersScreen } from './screens/OrdersScreen'
import { PlaceholderScreen } from './screens/PlaceholderScreen'
import { PromptPayScreen } from './screens/PromptPayScreen'
import { SellScreen } from './screens/SellScreen'

/**
 * Screen registry: one entry per `Screen`, each a small component that
 * only builds that screen's JSX from the shared `ScreenProps` — no logic
 * of its own beyond that. Rendered as `<Entry {...props} />` below (never
 * called as a plain function during App's render), so each one is a real
 * component in the tree.
 *
 * Placeholders receive the full `ScreenProps`, so a later task replaces one
 * with its real screen by changing only its own line here (plus an import),
 * e.g. `cash: (props) => <CashScreen {...props} />`. Order completion is
 * already handled below via `onOrderComplete`. Task 6 (orders + void) will
 * still need App-level additions for its bottom nav and order-detail view.
 */
const screens: Record<Screen, (props: ScreenProps) => ReactNode> = {
  sell: ({ cart, navigate, database }) => (
    <SellScreen cart={cart} onOpenCart={() => navigate('cart')} database={database} />
  ),
  cart: ({ cart, navigate }) => <CartScreen cart={cart} navigate={navigate} />,
  cash: (props) => <CashScreen {...props} />,
  // Keep this comment between `cash` and `promptpay`: tasks 4 and 5 each
  // change one of those lines on separate branches, and git treats edits to
  // adjacent lines as a conflict.
  // `settings` is unpacked rather than spread: PromptPayScreen takes the
  // one field it needs, and `null` (settings not loaded yet) travels
  // through as `null` so the screen can say so instead of guessing an ID.
  promptpay: ({ settings, ...props }) => (
    <PromptPayScreen {...props} promptPayId={settings === null ? null : settings.promptPayId} />
  ),
  orders: ({ database }) => <OrdersScreen database={database} />,
  report: (props) => <PlaceholderScreen {...props} title={SCREEN_TITLES.report} />,
  admin: (props) => <PlaceholderScreen {...props} title={SCREEN_TITLES.admin} />,
}

export default function App({ database = db }: { database?: PosDatabase }) {
  useEffect(() => {
    void seedIfEmpty(database)
  }, [database])

  // Call useCart() once here, above every ErrorBoundary, and pass it down —
  // calling it again in a screen would create a second, independent cart,
  // and a cart held only inside a boundary's subtree would be lost if that
  // subtree ever remounts after an error.
  const cart = useCart()
  const { clear } = cart

  // Read here, next to useCart(), so the settings query is already warm by
  // the time anyone taps PromptPay — the checkout must not wait on a read
  // it could have started at launch. `useSettings` is safe this high up
  // (above every ErrorBoundary) because `getSettings` never rejects.
  const settings = useSettings(database)

  const [screen, setScreen] = useState<Screen>(HOME_SCREEN)
  const [retryKey, setRetryKey] = useState(0)
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null)
  const shield = useTapShield()

  // setState's dispatch function is already stable across renders, so
  // `navigate` is too — no useCallback needed.
  const navigate = setScreen

  // A checkout screen calls this after `completeOrder` resolves: the sale is
  // stored, so empty the cart, go back to Sell and confirm it on screen.
  // Raising the shield here (not inside the checkout screen) means it fires
  // exactly once per completed sale, right as App swaps the screen back to
  // Sell in the same gesture that just paid — the moment a stray tap could
  // otherwise land on a product tile now sitting where "Done" used to be.
  const onOrderComplete = useCallback(
    (order: Order) => {
      shield.raise()
      clear()
      setCompletedOrder(order)
      setScreen(HOME_SCREEN)
    },
    // `useTapShield`'s return value is itself memoized (stable unless
    // `active` changes), so depending on the whole `shield` object here —
    // rather than reaching into it for `shield.raise`, which oxlint's
    // exhaustive-deps check doesn't recognize as a valid dependency entry —
    // still only recreates this callback on the rare renders where `active`
    // actually flips, not on every unrelated render.
    [clear, shield],
  )
  const dismissOrderToast = useCallback(() => setCompletedOrder(null), [])

  // Capture-phase, not a CSS overlay: jsdom does no hit-testing, so an
  // overlay's tests would pass while the real behaviour stayed broken.
  // Stopping propagation during capture means the tap never reaches
  // anything inside `.screen-wrap` (the tile's own onClick, CartBar's
  // onOpen, …) — the toast and the bottom nav are siblings of this wrapper,
  // outside it entirely, so they're untouched and stay tappable throughout.
  //
  // Guarded to Sell (`HOME_SCREEN`) only: the shield exists solely to stop a
  // stray tap landing on a product tile that's just replaced the checkout
  // screen's last button — a screen navigated to *during* the window (e.g.
  // tapping Orders right after a sale, then a row) was a deliberate tap on
  // a different screen the person chose to visit, not a residual tap from
  // the sale, and must never be eaten.
  const guardWhileShielded = useCallback(
    (event: SyntheticEvent) => {
      if (shield.active && screen === HOME_SCREEN) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    [shield.active, screen],
  )

  const Entry = screens[screen]
  const showNav = showsBottomNav(screen)

  return (
    <>
      <div className={showNav ? 'app-shell app-shell-with-nav' : 'app-shell'}>
        <div
          className="screen-wrap"
          onClickCapture={guardWhileShielded}
          onPointerDownCapture={guardWhileShielded}
        >
          <ErrorBoundary
            key={`${screen}:${retryKey}`}
            onRetry={() => setRetryKey((k) => k + 1)}
            onBack={screen === HOME_SCREEN ? undefined : () => setScreen(HOME_SCREEN)}
          >
            <Entry
              cart={cart}
              navigate={navigate}
              database={database}
              settings={settings}
              onOrderComplete={onOrderComplete}
            />
          </ErrorBoundary>
        </div>
        {/* A sibling of the tap-shielded wrapper (and so of the
            ErrorBoundary) above, never a descendant of either: a crashed
            screen must still leave the nav usable, and the shield that
            briefly blocks stray taps right after a sale must never block
            the nav. Omitted entirely (not just hidden) on cart/cash/
            promptpay, per `showsBottomNav`. */}
        {showNav && <BottomNav screen={screen} navigate={navigate} />}
      </div>
      {/* Always mounted, so screen readers announce the toast when it appears. */}
      <div className="order-toast-region" role="status">
        {completedOrder && (
          <OrderToast
            key={completedOrder.id}
            order={completedOrder}
            onDismiss={dismissOrderToast}
          />
        )}
      </div>
    </>
  )
}
