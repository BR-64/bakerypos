import { QRCodeSVG } from 'qrcode.react'
import './PromptPayScreen.css'
import { PROMPTPAY_ID } from '../config'
import { db, type PosDatabase } from '../db/db'
import { formatBaht } from '../domain/money'
import { isValidPromptPayId, promptPayPayload } from '../domain/promptpay'
import type { Order } from '../domain/types'
import { useCompleteOrder } from '../hooks/useCompleteOrder'
import type { Cart } from '../hooks/useCart'
import { type Screen } from '../navigation'

export interface PromptPayScreenProps {
  cart: Pick<Cart, 'lines' | 'total'>
  navigate: (screen: Screen) => void
  database?: PosDatabase
  onOrderComplete: (order: Order) => void
  /** Defaults to the configured shop ID; overridable (mainly for tests). */
  promptPayId?: string
}

/**
 * PromptPay checkout: show a QR for the cart total, generated locally from
 * `promptPayId` and `cart.total` — no network call anywhere in this path —
 * then staff tap "Paid — done" once they've seen the bank notification land.
 *
 * `useCompleteOrder` is the only way this stores the sale; on success it
 * calls `onOrderComplete` and App clears the cart, returns to Sell and shows
 * "Order #N — paid". On failure the cart is left untouched so staff can
 * retry.
 */
export function PromptPayScreen({
  cart,
  navigate,
  database = db,
  onOrderComplete,
  promptPayId = PROMPTPAY_ID,
}: PromptPayScreenProps) {
  const { pending, error, complete } = useCompleteOrder(cart.lines, database, onOrderComplete)

  const isEmpty = cart.lines.length === 0
  const isZero = cart.total <= 0
  const idValid = isValidPromptPayId(promptPayId)
  const isTestId = promptPayId === PROMPTPAY_ID
  const showQr = !isEmpty && !isZero && idValid
  const payload = showQr ? promptPayPayload(promptPayId, cart.total) : null

  return (
    <main className="app screen promptpay-screen">
      <header className="screen-header">
        <button
          type="button"
          className="back-button"
          disabled={pending}
          onClick={() => navigate('cart')}
        >
          Cancel
        </button>
        <h1>PromptPay</h1>
      </header>

      {isEmpty ? (
        <p className="promptpay-message muted">Cart is empty.</p>
      ) : (
        <>
          <p className="checkout-total">{formatBaht(cart.total)}</p>

          {error && (
            <p className="checkout-error" role="alert">
              {error}
            </p>
          )}

          {isZero ? (
            <p className="promptpay-message muted">Nothing to charge — use Cash</p>
          ) : !idValid ? (
            <p className="promptpay-message muted">PromptPay isn't set up</p>
          ) : (
            <div className="promptpay-qr-wrap">
              {isTestId && (
                <p className="promptpay-warning">Test PromptPay ID — not a real account</p>
              )}
              <QRCodeSVG
                className="promptpay-qr"
                value={payload ?? ''}
                size={224}
                marginSize={2}
                bgColor="#ffffff"
                fgColor="#000000"
                title={`PromptPay QR for ${formatBaht(cart.total)}`}
              />
            </div>
          )}
        </>
      )}

      <div className="bottom-bar promptpay-bottom-bar">
        <button
          type="button"
          className="promptpay-paid-button"
          disabled={pending || !showQr}
          onClick={() => complete({ method: 'promptpay', confirmedAt: new Date().toISOString() })}
        >
          Paid — done
        </button>
      </div>
    </main>
  )
}
