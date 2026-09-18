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
 * Screen registry: one entry per `Screen`, each building that screen's JSX
 * from the shared `ScreenProps` — no hooks, no logic beyond that. Tasks 4-7
 * each swap exactly one line here (plus its import) as cash/promptpay/
 * orders/report/admin get their real screens in place of the placeholder.
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

  const navigate = (next: Screen) => setScreen(next)

  return (
    <ErrorBoundary
      key={`${screen}:${retryKey}`}
      onRetry={() => setRetryKey((k) => k + 1)}
      onBack={screen === 'sell' ? undefined : () => setScreen('sell')}
    >
      {screens[screen]({ cart, navigate, database })}
    </ErrorBoundary>
  )
}
