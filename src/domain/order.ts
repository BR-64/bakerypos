import type { Order } from './types'

function isNonNegativeSafeInteger(n: unknown): n is number {
  return Number.isSafeInteger(n) && (n as number) >= 0
}

/** Whether an ISO-ish string actually parses to a real instant. */
function isParseableTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(new Date(value).getTime())
}

/**
 * Whether `payment` is a well-shaped `Payment` — a cash payment needs a
 * non-negative safe-integer `tendered` and `change` (satang; `changeDue`'s
 * own invariant that `change` is never negative isn't re-derived here, just
 * checked as data), a PromptPay payment needs a parseable `confirmedAt`.
 */
function isValidPayment(payment: unknown): boolean {
  if (typeof payment !== 'object' || payment === null || Array.isArray(payment)) return false
  const p = payment as Record<string, unknown>
  if (p.method === 'cash') {
    return isNonNegativeSafeInteger(p.tendered) && isNonNegativeSafeInteger(p.change)
  }
  if (p.method === 'promptpay') {
    return isParseableTimestamp(p.confirmedAt)
  }
  return false
}

/**
 * Whether `order`'s *header* fields — everything except `lines` — are
 * well-formed enough to show in the Orders list and the top of the detail
 * view:
 *
 * - `id` a non-empty string
 * - `number` a safe integer >= 1
 * - `total` a non-negative safe integer (satang) — rejects `NaN` and a
 *   value like `1e18` that exceeds `Number.MAX_SAFE_INTEGER`, same as
 *   `isValidCartLine`'s `unitPrice`
 * - `createdAt` a non-empty string that actually parses to an instant
 * - `status` exactly `'completed'` or `'voided'` — never guessed from
 *   truthiness
 * - `payment` well-shaped for its `method` (see `isValidPayment`)
 *
 * Lines are deliberately not checked here — a list row never renders them
 * (it shows `formatBaht(order.total)`, the *stored* total, never a
 * recomputed one), and the detail view validates them separately via
 * `partitionCartLines` (`src/domain/cart.ts`) so a corrupt line dims that
 * one order's line list without hiding the whole order, or the day's
 * takings, from the list.
 *
 * `order` is `unknown`, not `Order`, because a record read back from Dexie
 * is not guaranteed to match our TypeScript types — this must never throw
 * for `null`, an array, a BigInt, or anything else a hand-edited or
 * corrupted record could hold.
 */
export function isValidOrder(order: unknown): order is Order {
  if (typeof order !== 'object' || order === null || Array.isArray(order)) return false
  const o = order as Record<string, unknown>
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    Number.isSafeInteger(o.number) &&
    (o.number as number) >= 1 &&
    isNonNegativeSafeInteger(o.total) &&
    isParseableTimestamp(o.createdAt) &&
    (o.status === 'completed' || o.status === 'voided') &&
    isValidPayment(o.payment)
  )
}

export interface PartitionedOrders {
  /** Well-formed orders, safe to render. */
  valid: Order[]
  /** Invalid records — never rendered, only logged (see `isValidOrder`). */
  invalid: unknown[]
}

/**
 * Splits `orders` into the well-formed ones and the invalid ones, keeping
 * input order within each group. See `src/screens/OrdersScreen.tsx`, which
 * renders only `valid`, logs each `invalid` order once, and shows a muted
 * "N orders couldn't be displayed." footer so hidden money is still
 * accounted for.
 */
export function partitionOrders(orders: unknown[]): PartitionedOrders {
  const valid: Order[] = []
  const invalid: unknown[] = []
  for (const order of orders) {
    if (isValidOrder(order)) {
      valid.push(order)
    } else {
      invalid.push(order)
    }
  }
  return { valid, invalid }
}
