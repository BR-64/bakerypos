import { useState } from 'react'
import './CashScreen.css'
import { useCompleteOrder } from '../hooks/useCompleteOrder'
import type { Cart } from '../hooks/useCart'
import { formatBaht, quickTenderOptions } from '../domain/money'
import { cashPayment, deleteDigit, entryToSatang, pressDigit, type TenderEntry } from '../domain/tender'
import type { PosDatabase } from '../db/db'
import type { Order, Satang } from '../domain/types'
import type { Screen } from '../navigation'

export interface CashScreenProps {
  cart: Pick<Cart, 'lines' | 'total'>
  navigate: (screen: Screen) => void
  database: PosDatabase
  onOrderComplete: (order: Order) => void
}

const DIGIT_ROWS: readonly (readonly string[])[] = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
]

/**
 * Cash checkout: pick a quick-tender note (one tap completes the sale) or
 * type an amount on the keypad and tap Done. Reads only `cart.lines`/
 * `cart.total` — no Dexie reads here — and stores the sale exclusively via
 * `useCompleteOrder`, which App's `onOrderComplete` uses to clear the cart,
 * return to Sell and show the confirmation toast; this screen never does
 * either itself.
 *
 * The bottom bar swaps between the quick-tender notes (while `entry` is
 * empty) and a single Done button (once digits have been typed) — never
 * both — matching the "Cart → Cash → note = two taps" rule for the note
 * path, and keeping Done's enabled state tied only to what's been typed.
 */
export function CashScreen({ cart, navigate, database, onOrderComplete }: CashScreenProps) {
  const [entry, setEntry] = useState<TenderEntry>('')
  const { pending, error, complete } = useCompleteOrder(cart.lines, database, onOrderComplete)

  const isEmpty = cart.lines.length === 0
  const total = cart.total
  const tendered = entryToSatang(entry)
  const short = total - tendered

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

          <div className="cash-entry">
            <span className="cash-entry-amount">{formatBaht(tendered)}</span>
            {tendered >= total ? (
              <span className="cash-change">Change {formatBaht(tendered - total)}</span>
            ) : (
              <span className="cash-short">{formatBaht(short)} short</span>
            )}
          </div>

          <div className="cash-keypad">
            {DIGIT_ROWS.flat().map((digit) => (
              <button
                key={digit}
                type="button"
                className="cash-key"
                disabled={pending}
                onClick={() => setEntry((e) => pressDigit(e, digit))}
              >
                {digit}
              </button>
            ))}
            <span className="cash-key-spacer" aria-hidden="true" />
            <button
              type="button"
              className="cash-key"
              disabled={pending}
              onClick={() => setEntry((e) => pressDigit(e, '0'))}
            >
              0
            </button>
            <button
              type="button"
              className="cash-key cash-key-delete"
              aria-label="Delete digit"
              disabled={pending || entry === ''}
              onClick={() => setEntry((e) => deleteDigit(e))}
            >
              ⌫
            </button>
          </div>

          {/* Below the keypad, above the bottom bar: an error must never
              shift the keypad out from under the finger that was just
              tapping it. */}
          {error && (
            <p role="alert" className="checkout-error">
              {error}
            </p>
          )}
        </>
      )}

      {!isEmpty && (
        <div className="bottom-bar cash-bottom-bar">
          {entry === '' ? (
            quickTenderOptions(total).map((amount) => (
              <button
                key={amount}
                type="button"
                className="cash-tender-button"
                disabled={pending}
                onClick={() => payWith(amount)}
              >
                {amount === total ? `Exact ${formatBaht(amount)}` : formatBaht(amount)}
              </button>
            ))
          ) : (
            <button
              type="button"
              className="cash-done-button"
              disabled={pending || tendered < total}
              onClick={() => payWith(tendered)}
            >
              Done
            </button>
          )}
        </div>
      )}
    </main>
  )
}
