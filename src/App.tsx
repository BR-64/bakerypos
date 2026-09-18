import { useEffect } from 'react'
import { ErrorBoundary } from './components/ErrorBoundary'
import { seedIfEmpty } from './db/seed'
import { useCart } from './hooks/useCart'
import { SellScreen } from './screens/SellScreen'

export default function App() {
  useEffect(() => {
    void seedIfEmpty()
  }, [])

  // Call useCart() once here and pass it down — calling it again in a
  // screen would create a second, independent cart.
  const cart = useCart()

  return (
    <ErrorBoundary>
      <SellScreen cart={cart} />
    </ErrorBoundary>
  )
}
