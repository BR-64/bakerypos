import { useEffect, useRef, useState } from 'react'
import type { Cart } from '../hooks/useCart'
import { formatBaht, lineTotal } from '../domain/money'
import { HOME_SCREEN, type Screen } from '../navigation'

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

  // If the cart becomes empty while the confirm is open — stepping the
  // last line to 0, or the cart being cleared from outside this screen
  // (e.g. a shared cart mutated elsewhere while this component stays
  // mounted) — reset `confirming` here, during render, rather than in an
  // effect: oxlint's react(set-state-in-effect) flags an effect that only
  // derives state from other state as an unnecessary extra render, and
  // this is the documented React pattern for adjusting state in response
  // to a change (it bails out immediately, no re-render loop). Without
  // this, `confirming` would stay stranded `true` (just hidden by the
  // `!isEmpty` check below) and the confirm group would silently
  // resurface the moment the cart is non-empty again — e.g. the cart is
  // cleared from outside, then a line is added back from outside too,
  // all while this screen stays mounted.
  if (isEmpty && confirming) {
    setConfirming(false)
  }

  return (
    <main className="app screen cart-screen">
      <header className="screen-header">
        <button type="button" className="back-button" onClick={() => navigate(HOME_SCREEN)}>
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
            <p>
              Remove all {cart.count} item{cart.count === 1 ? '' : 's'}?
            </p>
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
                  navigate(HOME_SCREEN)
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
