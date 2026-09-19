import './CashScreen.css'
import { useCompleteOrder } from '../hooks/useCompleteOrder'
import type { Cart } from '../hooks/useCart'
import { formatBaht, quickTenderOptions } from '../domain/money'
import { cashPayment } from '../domain/tender'
import type { PosDatabase } from '../db/db'
import type { Order, Satang } from '../domain/types'
import type { Screen } from '../navigation'

export interface CashScreenProps {
  cart: Pick<Cart, 'lines' | 'total'>
  navigate: (screen: Screen) => void
  database: PosDatabase
  onOrderComplete: (order: Order) => void
}

/**
 * Cash checkout. Reads only `cart.lines`/`cart.total` — no Dexie reads here
 * — and stores the sale exclusively via `useCompleteOrder`, which App's
 * `onOrderComplete` uses to clear the cart, return to Sell and show the
 * confirmation toast; this screen never does either itself.
 *
 * For now this covers only the quick-tender note path: a bottom bar the
 * same height and position as Sell's cart bar holds `quickTenderOptions`
 * buttons ("Exact ฿X" first) and one tap completes the sale (Cart → Cash →
 * note = two taps). The keypad + Done path is added on top of this in a
 * later commit.
 */
export function CashScreen({ cart, navigate, database, onOrderComplete }: CashScreenProps) {
  const { pending, error, complete } = useCompleteOrder(cart.lines, database, onOrderComplete)

  const isEmpty = cart.lines.length === 0
  const total = cart.total

  function payWith(amount: Satang) {
    const payment = cashPayment(total, amount)
    if (payment) complete(payment)
  }

  return (
    <main className="app screen cash-screen">
      <header className="screen-header">
        <button
          type="button"
          className="back-button"
          disabled={pending}
          onClick={() => navigate('cart')}
        >
          Back to Cart
        </button>
        <h1>Cash</h1>
      </header>

      {isEmpty ? (
        <p className="cash-screen-message muted">Cart is empty.</p>
      ) : (
        <>
          <p className="checkout-total">{formatBaht(total)}</p>

          {error && (
            <p role="alert" className="checkout-error">
              {error}
            </p>
          )}
        </>
      )}

      {!isEmpty && (
        <div className="bottom-bar cash-bottom-bar">
          {quickTenderOptions(total).map((amount) => (
            <button
              key={amount}
              type="button"
              className="cash-tender-button"
              disabled={pending}
              onClick={() => payWith(amount)}
            >
              {amount === total ? `Exact ${formatBaht(amount)}` : formatBaht(amount)}
            </button>
          ))}
        </div>
      )}
    </main>
  )
}
