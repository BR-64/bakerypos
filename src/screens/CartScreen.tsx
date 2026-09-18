import { useEffect, useRef, useState } from 'react'
import type { Cart } from '../hooks/useCart'
import { formatBaht, lineTotal } from '../domain/money'
import type { Screen } from '../navigation'

export interface CartScreenProps {
  cart: Pick<Cart, 'lines' | 'total' | 'count' | 'increment' | 'decrement' | 'clear'>
  navigate: (screen: Screen) => void
}

/**
 * Review and adjust the current sale, then head to Cash or PromptPay.
 * Reads only the `cart` prop — no Dexie reads here — so it works offline
 * exactly like the Sell screen.
 *
 * `cart.lines` already excludes invalid lines and logs them once (see
 * `useCart`), so this component never needs to validate anything itself.
 *
 * "+" (increment) deliberately ignores the product's current stock state:
 * once a line exists, bumping its qty always works, even if the product
 * has since been archived or gone out of stock (task 1 decision — see
 * `src/domain/cart.ts` `addProduct`/`increment`). "−" (decrement) removes
 * the line once qty reaches 0.
 */
export function CartScreen({ cart, navigate }: CartScreenProps) {
  const [confirming, setConfirming] = useState(false)
  const keepButtonRef = useRef<HTMLButtonElement>(null)
  const isEmpty = cart.lines.length === 0

  // "Keep" takes focus the moment the confirm group opens.
  useEffect(() => {
    if (confirming) keepButtonRef.current?.focus()
  }, [confirming])

  // The confirm group is gated on `!isEmpty` below (never rendered once the
  // cart is empty), so stepping the last line to 0 while it's open closes
  // it without needing a separate effect to reset `confirming` — and there
  // is no way to un-empty the cart from within this screen (no "+" button
  // survives once its line is gone), so a stale `confirming: true` can
  // never resurface later in the same mount.

  return (
    <main className="app screen cart-screen">
      <header className="screen-header">
        <button type="button" className="back-button" onClick={() => navigate('sell')}>
          Back to Sell
        </button>
        <h1>Cart</h1>
      </header>

      {isEmpty ? (
        <p className="cart-screen-message muted">Cart is empty.</p>
      ) : (
        <ul className="cart-lines">
          {cart.lines.map((line) => (
            <li key={line.productId} className="cart-line">
              <div className="cart-line-info">
                <span className="cart-line-name">{line.name}</span>
                <span className="cart-line-unit-price muted">{formatBaht(line.unitPrice)} each</span>
              </div>
              <div className="cart-line-steppers">
                <button
                  type="button"
                  className="stepper-button"
                  aria-label={`Remove one ${line.name}`}
                  onClick={() => cart.decrement(line.productId)}
                >
                  −
                </button>
                <span className="cart-line-qty">{line.qty}</span>
                <button
                  type="button"
                  className="stepper-button"
                  aria-label={`Add one ${line.name}`}
                  onClick={() => cart.increment(line.productId)}
                >
                  +
                </button>
              </div>
              <strong className="cart-line-total">{formatBaht(lineTotal(line))}</strong>
            </li>
          ))}
        </ul>
      )}

      <div className="cart-clear">
        {confirming && !isEmpty ? (
          <div role="group" aria-label="Clear cart?" className="cart-clear-confirm">
            <p>Remove all {cart.count} items?</p>
            <div className="cart-clear-confirm-actions">
              <button
                ref={keepButtonRef}
                type="button"
                className="cart-clear-keep"
                onClick={() => setConfirming(false)}
              >
                Keep
              </button>
              <button
                type="button"
                className="cart-clear-yes"
                onClick={() => {
                  cart.clear()
                  navigate('sell')
                }}
              >
                Yes, clear
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="cart-clear-button"
            disabled={isEmpty}
            onClick={() => setConfirming(true)}
          >
            Clear cart
          </button>
        )}
      </div>

      <div className="bottom-bar cart-bottom-bar">
        <span className="cart-bottom-bar-total">Total {formatBaht(cart.total)}</span>
        <button
          type="button"
          className="pay-button pay-button-cash"
          disabled={isEmpty}
          onClick={() => navigate('cash')}
        >
          Cash
        </button>
        <button
          type="button"
          className="pay-button pay-button-promptpay"
          disabled={isEmpty}
          onClick={() => navigate('promptpay')}
        >
          PromptPay
        </button>
      </div>
    </main>
  )
}
