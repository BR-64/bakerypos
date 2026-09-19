import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OrderToast } from './components/OrderToast'
import { db, type PosDatabase } from './db/db'
import { seedIfEmpty } from './db/seed'
import type { Order } from './domain/types'
import { useCart } from './hooks/useCart'
import { HOME_SCREEN, SCREEN_TITLES, type Screen, type ScreenProps } from './navigation'
import { CartScreen } from './screens/CartScreen'
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
  cash: (props) => <PlaceholderScreen {...props} title={SCREEN_TITLES.cash} />,
  // Keep this comment between `cash` and `promptpay`: tasks 4 and 5 each
  // change one of those lines on separate branches, and git treats edits to
  // adjacent lines as a conflict.
  promptpay: (props) => <PromptPayScreen {...props} />,
  orders: (props) => <PlaceholderScreen {...props} title={SCREEN_TITLES.orders} />,
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

  const [screen, setScreen] = useState<Screen>(HOME_SCREEN)
  const [retryKey, setRetryKey] = useState(0)
  const [completedOrder, setCompletedOrder] = useState<Order | null>(null)

  // setState's dispatch function is already stable across renders, so
  // `navigate` is too — no useCallback needed.
  const navigate = setScreen

  // A checkout screen calls this after `completeOrder` resolves: the sale is
  // stored, so empty the cart, go back to Sell and confirm it on screen.
  const onOrderComplete = useCallback(
    (order: Order) => {
      clear()
      setCompletedOrder(order)
      setScreen(HOME_SCREEN)
    },
    [clear],
  )
  const dismissOrderToast = useCallback(() => setCompletedOrder(null), [])

  const Entry = screens[screen]

  return (
    <>
      <ErrorBoundary
        key={`${screen}:${retryKey}`}
        onRetry={() => setRetryKey((k) => k + 1)}
        onBack={screen === HOME_SCREEN ? undefined : () => setScreen(HOME_SCREEN)}
      >
        <Entry
          cart={cart}
          navigate={navigate}
          database={database}
          onOrderComplete={onOrderComplete}
        />
      </ErrorBoundary>
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
