import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import './OrdersScreen.css'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { db, type PosDatabase } from '../db/db'
import { todaysOrders } from '../db/orders'
import { partitionCartLines } from '../domain/cart'
import { formatLocalTime } from '../domain/day'
import { safeString } from '../domain/log'
import { formatBaht, lineTotal } from '../domain/money'
import { partitionOrders } from '../domain/order'
import type { CartLine, Order } from '../domain/types'
import { MAX_VOID_REASON_LENGTH, normalizeVoidReason, VOID_REASONS } from '../domain/voidReason'
import { useLogInvalidOnce } from '../hooks/useLogInvalidOnce'
import { useVoidOrder } from '../hooks/useVoidOrder'

export interface OrdersScreenProps {
  database?: PosDatabase
}

/**
 * Today's orders, newest-first, with a tap-through detail (snapshot lines,
 * stored total, payment) and reason-and-confirm void.
 *
 * The detail is this screen's own `selectedId` state, not a new `Screen`
 * member: the bottom nav keeps highlighting Orders while it's open, and
 * `OrdersBody`'s single `useLiveQuery` feeds both the list and the detail
 * (looked up from the same result), so there's only ever one read of
 * today's orders in flight.
 *
 * `OrdersBody` is wrapped in its own `ErrorBoundary`, the same pattern as
 * `SellScreen`'s `ProductGrid`: `useLiveQuery` re-throws during render if
 * the query rejects, "Try again" remounts and retries it, "Reload" falls
 * back to reloading the page.
 */
export function OrdersScreen({ database = db }: OrdersScreenProps) {
  const [retryKey, setRetryKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <main className="app screen orders-screen">
      <h1 className="orders-title">Orders</h1>
      <ErrorBoundary
        key={retryKey}
        onRetry={() => {
          // Reset the open detail too, not just the boundary's remount key:
          // if whatever's open crashed rendering (e.g. a corrupt field
          // `isValidOrder` doesn't yet know to check), leaving `selectedId`
          // pointed at the same order would just crash again on "Try
          // again", forever, with only the nav able to escape.
          setSelectedId(null)
          setRetryKey((k) => k + 1)
        }}
      >
        <OrdersBody
          database={database}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onBack={() => setSelectedId(null)}
        />
      </ErrorBoundary>
    </main>
  )
}

interface OrdersBodyProps {
  database: PosDatabase
  selectedId: string | null
  onSelect: (id: string) => void
  onBack: () => void
}

/**
 * Dedup key for an invalid order: its id when present, otherwise a
 * stringified copy of the whole record.
 */
function invalidOrderKey(order: unknown): string {
  if (typeof order === 'object' && order !== null) {
    const id = (order as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return safeString(order)
}

function describeInvalidOrder(order: unknown): string {
  return `OrdersScreen: skipping invalid order ${invalidOrderKey(order)} — ${safeString(order)}`
}

function OrdersBody({ database, selectedId, onSelect, onBack }: OrdersBodyProps) {
  // The day range is computed fresh inside this callback (via
  // `todaysOrders`'s own `new Date()` default) every time it reruns — never
  // hoisted into the dependency array, where a `Date` object would compare
  // unequal to itself on every render and defeat `useLiveQuery`'s memoization
  // anyway.
  const orders = useLiveQuery(() => todaysOrders(database), [database])

  const { valid, invalid } = partitionOrders(orders ?? [])
  useLogInvalidOnce(invalid, invalidOrderKey, describeInvalidOrder)

  if (orders === undefined) {
    return <p className="orders-message muted">Loading orders…</p>
  }

  if (selectedId !== null) {
    const selected = valid.find((o) => o.id === selectedId)
    if (!selected) {
      // Orders are never deleted, so this only happens if the order rolled
      // out of "today" (midnight passed while the screen stayed open) or
      // turned out invalid — either way, never auto-navigate out from
      // under the person looking at it; let them tap Back themselves.
      return (
        <div className="orders-detail-missing">
          <p className="muted">This order is no longer available.</p>
          <button type="button" className="back-button" onClick={onBack}>
            Back
          </button>
        </div>
      )
    }
    return <OrderDetail order={selected} database={database} onBack={onBack} />
  }

  return (
    <>
      {valid.length === 0 ? (
        <p className="orders-message muted">No orders yet today.</p>
      ) : (
        <ul className="orders-list">
          {valid.map((order) => (
            <li key={order.id}>
              <OrderRow order={order} onSelect={onSelect} />
            </li>
          ))}
        </ul>
      )}
      {/* Corrupt orders are hidden, not silently dropped — this keeps their
          money accounted for even though they can't be shown or voided. */}
      {invalid.length > 0 && (
        <p className="orders-invalid-footer muted">
          {invalid.length} order{invalid.length === 1 ? '' : 's'} couldn't be displayed.
        </p>
      )}
    </>
  )
}

function OrderRow({ order, onSelect }: { order: Order; onSelect: (id: string) => void }) {
  return (
    <button type="button" className="orders-row" onClick={() => onSelect(order.id)}>
      <span className="orders-row-number">#{order.number}</span>
      <span className="orders-row-time muted">{formatLocalTime(order.createdAt)}</span>
      <span className="orders-row-total">{formatBaht(order.total)}</span>
      <span className="orders-row-method muted">
        {order.payment.method === 'cash' ? 'Cash' : 'PromptPay'}
      </span>
      {order.status === 'voided' && <span className="orders-row-badge">Voided</span>}
    </button>
  )
}

/** Dedup key for an invalid line inside a specific order's detail. */
function invalidOrderLineKey(orderId: string, line: unknown): string {
  const productId =
    typeof line === 'object' && line !== null
      ? (line as Record<string, unknown>).productId
      : undefined
  return `${orderId}:${typeof productId === 'string' && productId.length > 0 ? productId : safeString(line)}`
}

function describeInvalidOrderLine(orderId: string, line: unknown): string {
  return `OrdersScreen: skipping invalid line in order ${orderId} — ${safeString(line)}`
}

interface OrderDetailProps {
  order: Order
  database: PosDatabase
  onBack: () => void
}

/**
 * One order's snapshot lines, stored total and payment, plus void. Lines
 * are validated separately from the header (`isValidOrder` covers header
 * fields only) by reusing `partitionCartLines` — a corrupt line is skipped
 * and logged, never crashes the detail, and never blocks voiding the order.
 */
function OrderDetail({ order, database, onBack }: OrderDetailProps) {
  const rawLines: CartLine[] = Array.isArray(order.lines) ? order.lines : []
  const { valid: validLines, invalid: invalidLines } = partitionCartLines(rawLines)
  useLogInvalidOnce(
    invalidLines,
    (line) => invalidOrderLineKey(order.id, line),
    (line) => describeInvalidOrderLine(order.id, line),
  )

  const [voidPanelOpen, setVoidPanelOpen] = useState(false)
  const [reasonChoice, setReasonChoice] = useState('')
  const [otherText, setOtherText] = useState('')
  const keepButtonRef = useRef<HTMLButtonElement>(null)

  // Closes the panel (and clears its fields) the instant a void succeeds —
  // in the same update as `pending` returning to `false` — rather than
  // waiting for `useLiveQuery` to re-emit the now-voided order (which is
  // what actually makes `isVoided` hide "Yes, void" below). Without this, a
  // second real tap could land in that gap and void the same order again,
  // rewriting `voidedAt`/`sync`.
  const { pending, error, voidOrder, reset } = useVoidOrder(database, () => {
    setVoidPanelOpen(false)
    setReasonChoice('')
    setOtherText('')
  })

  useEffect(() => {
    if (voidPanelOpen) keepButtonRef.current?.focus()
  }, [voidPanelOpen])

  const isVoided = order.status === 'voided'
  const reasonInput = reasonChoice === 'Other' ? otherText : reasonChoice
  const normalizedReason = normalizeVoidReason(reasonInput)

  function closeVoidPanel() {
    setVoidPanelOpen(false)
    setReasonChoice('')
    setOtherText('')
    // Otherwise a failed attempt's alert would still be showing the next
    // time the panel opens, before anything has been retried — reading as
    // a fresh failure that hasn't actually happened yet.
    reset()
  }

  return (
    <div className="orders-detail">
      <button type="button" className="back-button" onClick={onBack}>
        Back
      </button>

      <h2 className="orders-detail-heading">
        Order #{order.number}
        {isVoided && <span className="orders-row-badge">Voided</span>}
      </h2>
      <p className="muted orders-detail-time">{formatLocalTime(order.createdAt)}</p>

      <ul className="orders-detail-lines">
        {validLines.map((line) => (
          <li key={line.productId} className="orders-detail-line">
            <span className="orders-detail-line-name">
              {line.name} × {line.qty}
            </span>
            <span className="orders-detail-line-total">{formatBaht(lineTotal(line))}</span>
          </li>
        ))}
      </ul>
      {invalidLines.length > 0 && (
        <p className="orders-invalid-footer muted">
          {invalidLines.length} item{invalidLines.length === 1 ? '' : 's'} couldn't be displayed.
        </p>
      )}

      <p className="orders-detail-total">Total {formatBaht(order.total)}</p>

      <p className="orders-detail-payment muted">
        {order.payment.method === 'cash'
          ? `Cash — tendered ${formatBaht(order.payment.tendered)}, change ${formatBaht(order.payment.change)}`
          : `PromptPay — confirmed ${formatLocalTime(order.payment.confirmedAt)}`}
      </p>

      {isVoided ? (
        <p className="orders-detail-void-reason muted">Void reason: {order.voidReason}</p>
      ) : voidPanelOpen ? (
        <div role="group" aria-label="Void this order?" className="orders-void-confirm">
          <div className="orders-void-reasons">
            {VOID_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                className="orders-void-reason-button"
                aria-pressed={reasonChoice === reason}
                disabled={pending}
                onClick={() => setReasonChoice(reason)}
              >
                {reason}
              </button>
            ))}
          </div>
          {reasonChoice === 'Other' && (
            <input
              type="text"
              className="orders-void-other-input"
              aria-label="Void reason"
              placeholder="Reason"
              maxLength={MAX_VOID_REASON_LENGTH}
              value={otherText}
              disabled={pending}
              onChange={(e) => setOtherText(e.target.value)}
            />
          )}
          {error && (
            <p role="alert" className="checkout-error">
              {error}
            </p>
          )}
          <div className="orders-void-confirm-actions">
            <button
              ref={keepButtonRef}
              type="button"
              className="orders-void-keep"
              disabled={pending}
              onClick={closeVoidPanel}
            >
              Keep order
            </button>
            <button
              type="button"
              className="orders-void-yes"
              disabled={pending || normalizedReason === null}
              onClick={() => {
                if (normalizedReason) voidOrder(order.id, normalizedReason)
              }}
            >
              Yes, void
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="orders-void-button" onClick={() => setVoidPanelOpen(true)}>
          Void this order
        </button>
      )}
    </div>
  )
}
