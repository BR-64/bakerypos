import { v4 as uuid } from 'uuid'
import { partitionCartLines } from '../domain/cart'
import { localDayRange } from '../domain/day'
import { cartTotal } from '../domain/money'
import type { StockSkip } from '../domain/stock'
import type { CartLine, Order, Payment } from '../domain/types'
import { db, type PosDatabase } from './db'
import { applySaleStock, applyVoidStock } from './stock'

const isNonNegativeSafeInteger = (n: unknown): n is number =>
  Number.isSafeInteger(n) && (n as number) >= 0

/**
 * Create a completed order from the cart. Runs in one transaction so the
 * running order number can never be duplicated on this device.
 *
 * Rejects (never stores) an order that could record the wrong money: any
 * invalid, duplicate or total-overflowing line, cash that is negative,
 * fractional or doesn't balance, or a PromptPay order for ฿0 (promptpay-qr
 * would emit a QR with no amount in it). Callers catch the rejection and keep
 * the cart.
 */
export async function completeOrder(
  lines: CartLine[],
  payment: Payment,
  database: PosDatabase = db,
): Promise<Order> {
  if (lines.length === 0) throw new Error('Cannot complete an empty order')
  if (partitionCartLines(lines).invalid.length > 0) {
    throw new Error('Cannot complete an order with invalid lines')
  }
  const total = cartTotal(lines)
  if (payment.method === 'cash') {
    if (!isNonNegativeSafeInteger(payment.tendered) || !isNonNegativeSafeInteger(payment.change)) {
      throw new Error('Cash tendered and change must be non-negative integer satang')
    }
    if (payment.tendered - payment.change !== total) {
      throw new Error('Cash payment does not balance with order total')
    }
  } else if (total <= 0) {
    throw new Error('Cannot take a PromptPay payment for ฿0')
  }

  // Stock (task 8d) moves in this same transaction, so the order and its
  // stock movements are all-or-nothing. Bad stock data is skipped by
  // `applySaleStock` before any write and never fails the sale; only a
  // failing write (the same IndexedDB the order lives in) aborts it.
  const { order, skipped } = await database.transaction(
    'rw',
    database.orders,
    database.products,
    database.stockMovements,
    async () => {
      const last = await database.orders.orderBy('number').last()
      const order: Order = {
        id: uuid(),
        number: (last?.number ?? 0) + 1,
        lines: lines.map((l) => ({ ...l })),
        total,
        payment,
        status: 'completed',
        createdAt: new Date().toISOString(),
        sync: 'pending',
      }
      await database.orders.add(order)
      const skipped = await applySaleStock(database, order)
      return { order, skipped }
    },
  )
  logSkippedStock('completeOrder', skipped)
  return order
}

/**
 * Void an order. It stays in the DB (and in the Z report, under "voided").
 *
 * One transaction with the stock add-back (task 8d). Voiding an order that
 * is already voided writes nothing — `voidedAt`/`voidReason` stay as they
 * were and no stock moves — so a repeated void can never add a sale back
 * twice, whatever the UI does.
 */
export async function voidOrder(
  id: string,
  reason: string,
  database: PosDatabase = db,
): Promise<void> {
  const skipped = await database.transaction(
    'rw',
    database.orders,
    database.products,
    database.stockMovements,
    async () => {
      const stored = await database.orders.get(id)
      if (stored === undefined) throw new Error(`Order ${id} not found`)
      if (stored.status === 'voided') return []
      const voided = {
        status: 'voided' as const,
        voidedAt: new Date().toISOString(),
        voidReason: reason,
        sync: 'pending' as const,
      }
      await database.orders.update(id, voided)
      return applyVoidStock(database, { ...stored, ...voided, id })
    },
  )
  logSkippedStock('voidOrder', skipped)
}

/** Called after commit: a skipped product is logged, never thrown. */
function logSkippedStock(where: string, skipped: StockSkip[]): void {
  for (const skip of skipped) {
    console.error(`${where}: stock not changed for product ${skip.productId}: ${skip.reason}`)
  }
}

/**
 * Every order stored on one local calendar day (completed and voided
 * alike), newest-first. Backs both the Orders screen (via `todaysOrders`)
 * and the Z report, which can be run for any past day. Additive only —
 * does not change `completeOrder`/`voidOrder`.
 *
 * Reads via the indexed `createdAt` range rather than `toArray()` +
 * filtering in JS, unlike `sellableProducts`: order history only grows, so
 * scanning every row on every render isn't acceptable the way it is for the
 * (bounded) product list.
 *
 * That indexed read is also this function's one documented blind spot, and
 * it's broader than just "missing" or "non-string": the comparison is a
 * plain string comparison against `startISO`/`endISO`, both produced by
 * `Date#toISOString()`, which always normalizes to UTC with a trailing `Z`
 * (fixed-width, zero-padded, so string order matches chronological order
 * exactly). `completeOrder` only ever writes `createdAt` that way, so in
 * practice this is exactly what's stored — but *only* a `createdAt` in that
 * same normalized `…Z` shape is guaranteed to sort correctly against the
 * range and so can appear in the result. Anything else — missing, not a
 * string, or a syntactically valid ISO instant with an explicit numeric
 * offset instead of `Z` (e.g. `'2026-01-14T07:00:01.000-10:00'`, which
 * `isValidOrder` would accept as parseable, and which may well be *inside*
 * today by the clock) — compares unpredictably against the range and can
 * silently fail to appear, or appear on the wrong side of midnight, with no
 * error and no count anywhere: the row is invisible to this function, not
 * merely rejected by it, so there's nothing here for `isValidOrder`/
 * `partitionOrders` (`src/domain/order.ts`) to validate or log — they only
 * ever see what this query actually returns.
 *
 * `between(startISO, endISO, true, false)` is the half-open range
 * `[startISO, endISO)` from `localDayRange`. Sorted newest-first by
 * `createdAt`, then by `number` descending as a tiebreaker for two orders
 * stored in the same millisecond.
 */
export async function ordersForDay(
  database: PosDatabase = db,
  day: Date = new Date(),
): Promise<Order[]> {
  const { startISO, endISO } = localDayRange(day)
  const orders = await database.orders
    .where('createdAt')
    .between(startISO, endISO, true, false)
    .toArray()
  return orders.sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    return b.number - a.number
  })
}

/**
 * The orders on the local day containing `now` — i.e. today, for the
 * Orders screen. A thin alias for `ordersForDay`, which holds the
 * implementation and every caveat documented above.
 */
export async function todaysOrders(
  database: PosDatabase = db,
  now: Date = new Date(),
): Promise<Order[]> {
  return ordersForDay(database, now)
}
