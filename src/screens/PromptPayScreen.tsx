import { QRCodeSVG } from 'qrcode.react'
import './PromptPayScreen.css'
import { db, type PosDatabase } from '../db/db'
import { formatBaht } from '../domain/money'
import {
  canEncodePromptPayAmount,
  isValidPromptPayId,
  PLACEHOLDER_PROMPTPAY_ID,
  promptPayPayload,
} from '../domain/promptpay'
import type { Order } from '../domain/types'
import { useCompleteOrder } from '../hooks/useCompleteOrder'
import type { Cart } from '../hooks/useCart'
import type { Screen } from '../navigation'

export interface PromptPayScreenProps {
  cart: Pick<Cart, 'lines' | 'total'>
  navigate: (screen: Screen) => void
  database?: PosDatabase
  onOrderComplete: (order: Order) => void
  /**
   * The account the QR pays, from the settings row (App passes
   * `settings.promptPayId`). Required, with **no module-level default**:
   * there is no safe value to guess for the recipient of a customer's
   * money.
   *
   * `null` means the settings read hasn't landed yet — the screen says so,
   * shows no QR and keeps "Paid — done" disabled, rather than rendering a
   * QR built from a placeholder that might not be what's actually stored.
   */
  promptPayId: string | null
  /**
   * True when the settings read **failed**, so `promptPayId` is a default
   * that was never stored. The screen then says "PromptPay isn't set up —
   * use Cash" and shows no QR at all.
   *
   * Task 7b changed this deliberately: before, a failed read looked exactly
   * like "no settings row yet" and produced a placeholder QR. A shop that
   * *has* configured a real ID would then have had a customer scan a QR
   * paying the fake placeholder account, with only a small warning line to
   * say so. "No row yet" still shows the placeholder QR and its test-ID
   * warning — that case genuinely has nothing stored to contradict.
   */
  settingsFailed?: boolean
}

/**
 * PromptPay checkout: show a QR for the cart total, generated locally from
 * `promptPayId` (the stored settings row, passed down by App) and
 * `cart.total` — no network call anywhere in this path — then staff tap
 * "Paid — done" once they've seen the bank notification land.
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
  promptPayId,
  settingsFailed = false,
}: PromptPayScreenProps) {
  const { pending, error, complete } = useCompleteOrder(cart.lines, database, onOrderComplete)

  const isEmpty = cart.lines.length === 0
  const isZero = cart.total <= 0
  const amountFits = canEncodePromptPayAmount(cart.total)
  const idLoaded = promptPayId !== null
  // A failed settings read means we don't know the shop's ID — the value
  // passed in is a default, not something stored — so it is treated as
  // "not set up" rather than as an ID to build a QR from.
  const idValid = idLoaded && !settingsFailed && isValidPromptPayId(promptPayId)
  const isTestId = promptPayId === PLACEHOLDER_PROMPTPAY_ID
  const showQr = !isEmpty && !isZero && amountFits && idValid
  const payload = showQr && promptPayId !== null ? promptPayPayload(promptPayId, cart.total) : null

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
          ) : !amountFits ? (
            <p className="promptpay-message muted">
              Amount too large for a PromptPay QR — use Cash
            </p>
          ) : !idLoaded ? (
            <p className="promptpay-message muted">Loading PromptPay settings…</p>
          ) : !idValid ? (
            <p className="promptpay-message muted">PromptPay isn&rsquo;t set up — use Cash</p>
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
