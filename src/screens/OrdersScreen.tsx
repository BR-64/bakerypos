import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import './OrdersScreen.css'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { db, type PosDatabase } from '../db/db'
import { todaysOrders } from '../db/orders'
import { formatLocalTime } from '../domain/day'
import { safeString } from '../domain/log'
import { formatBaht } from '../domain/money'
import { partitionOrders } from '../domain/order'
import type { Order } from '../domain/types'
import { useLogInvalidOnce } from '../hooks/useLogInvalidOnce'

export interface OrdersScreenProps {
  database?: PosDatabase
}

/**
 * Today's orders, newest-first — list only for now; tapping a row opens its
 * detail (with void) in a later change to this same screen.
 *
 * `OrdersList` is wrapped in its own `ErrorBoundary`, the same pattern as
 * `SellScreen`'s `ProductGrid`: `useLiveQuery` re-throws during render if
 * the query rejects, "Try again" remounts and retries it, "Reload" falls
 * back to reloading the page.
 */
export function OrdersScreen({ database = db }: OrdersScreenProps) {
  const [retryKey, setRetryKey] = useState(0)

  return (
    <main className="app screen orders-screen">
      <h1 className="orders-title">Orders</h1>
      <ErrorBoundary key={retryKey} onRetry={() => setRetryKey((k) => k + 1)}>
        <OrdersList database={database} />
      </ErrorBoundary>
    </main>
  )
}

interface OrdersListProps {
  database: PosDatabase
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

function OrdersList({ database }: OrdersListProps) {
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

  return (
    <>
      {valid.length === 0 ? (
        <p className="orders-message muted">No orders yet today.</p>
      ) : (
        <ul className="orders-list">
          {valid.map((order) => (
            <li key={order.id}>
              <OrderRow order={order} />
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

function OrderRow({ order }: { order: Order }) {
  return (
    <button type="button" className="orders-row">
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
