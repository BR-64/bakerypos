import { useEffect, useState, type ReactNode } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { db, type PosDatabase } from './db/db'
import { seedIfEmpty } from './db/seed'
import { useCart } from './hooks/useCart'
import { HOME_SCREEN, SCREEN_TITLES, type Screen, type ScreenProps } from './navigation'
import { CartScreen } from './screens/CartScreen'
import { PlaceholderScreen } from './screens/PlaceholderScreen'
import { SellScreen } from './screens/SellScreen'

/**
 * Screen registry: one entry per `Screen`, each a small component that
 * only builds that screen's JSX from the shared `ScreenProps` — no logic
 * of its own beyond that. Rendered as `<Entry {...props} />` below (never
 * called as a plain function during App's render), so each one is a real
 * component in the tree.
 *
 * For most of cash/promptpay/orders/report/admin, replacing the
 * placeholder with the real screen is indeed just swapping one line here
 * plus an import — but that's not the whole story for every task: task 4
 * (cash checkout) also needs an order-confirmation toast that outlives the
 * Cash screen itself, and task 6 (orders + void) adds a bottom nav and an
 * order-detail view. Both are App-level additions, not just a registry
 * swap.
 */
const screens: Record<Screen, (props: ScreenProps) => ReactNode> = {
  sell: ({ cart, navigate, database }) => (
    <SellScreen cart={cart} onOpenCart={() => navigate('cart')} database={database} />
  ),
  cart: ({ cart, navigate }) => <CartScreen cart={cart} navigate={navigate} />,
  cash: ({ navigate }) => <PlaceholderScreen title={SCREEN_TITLES.cash} navigate={navigate} />,
  promptpay: ({ navigate }) => (
    <PlaceholderScreen title={SCREEN_TITLES.promptpay} navigate={navigate} />
  ),
  orders: ({ navigate }) => <PlaceholderScreen title={SCREEN_TITLES.orders} navigate={navigate} />,
  report: ({ navigate }) => <PlaceholderScreen title={SCREEN_TITLES.report} navigate={navigate} />,
  admin: ({ navigate }) => <PlaceholderScreen title={SCREEN_TITLES.admin} navigate={navigate} />,
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

  const [screen, setScreen] = useState<Screen>(HOME_SCREEN)
  const [retryKey, setRetryKey] = useState(0)

  // setState's dispatch function is already stable across renders, so
  // `navigate` is too — no useCallback needed.
  const navigate = setScreen

  const Entry = screens[screen]

  return (
    <ErrorBoundary
      key={`${screen}:${retryKey}`}
      onRetry={() => setRetryKey((k) => k + 1)}
      onBack={screen === HOME_SCREEN ? undefined : () => setScreen(HOME_SCREEN)}
    >
      <Entry cart={cart} navigate={navigate} database={database} />
    </ErrorBoundary>
  )
}
