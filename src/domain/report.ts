import { partitionCartLines } from './cart'
import { localDayKey, localDayRange } from './day'
import { cartTotal, formatBaht, lineTotal } from './money'
import { partitionOrders } from './order'
import type { CartLine, Satang } from './types'

/** One product's share of a day's takings, from the snapshot line prices. */
export interface ZReportProduct {
  productId: string
  /** The snapshot name from the first line seen — never today's product name. */
  name: string
  units: number
  revenue: Satang
}

/** End-of-day (Z) totals for one local calendar day. */
export interface ZReport {
  /** `localDayKey(day)`, or `''` if `day` wasn't a usable Date. */
  dayKey: string
  /** Completed orders only. */
  orderCount: number
  /** Sum of the **stored** totals of those completed orders. */
  total: Satang
  /** The cash share of `total` — what should be in the drawer. */
  cashTotal: Satang
  /** The PromptPay share of `total`. */
  promptPayTotal: Satang
  /** Units and revenue per product, busiest (by revenue) first. */
  products: ZReportProduct[]
  /** Voided orders: reported, but in none of the totals above. */
  voidedCount: number
  voidedTotal: Satang
  /** Records too corrupt to attribute to anything (see `partitionOrders`). */
  invalidCount: number
  /**
   * Completed orders whose readable lines don't add up to the stored
   * total — a corrupt line, a duplicate, or a genuine discrepancy. The
   * money in this report still uses the stored total; this is the count
   * that says "the item breakdown below is short".
   */
  mismatchedTotalCount: number
}

function emptyReport(dayKey: string): ZReport {
  return {
    dayKey,
    orderCount: 0,
    total: 0,
    cashTotal: 0,
    promptPayTotal: 0,
    products: [],
    voidedCount: 0,
    voidedTotal: 0,
    invalidCount: 0,
    mismatchedTotalCount: 0,
  }
}

function isSafeSum(running: number, addend: number): boolean {
  return Number.isSafeInteger(running + addend)
}

/**
 * Build the Z report for one local calendar day.
 *
 * Pure: no React, no Dexie, so task 9's server can import it unchanged.
 * `orders` is `unknown[]` because the records come from IndexedDB, which
 * CLAUDE.md treats as untrusted — this must never throw, whatever it is
 * handed.
 *
 * Three deliberate decisions:
 *
 * 1. **The stored `order.total` is the money**, never a total recomputed
 *    from the lines. That's the number the customer actually paid and the
 *    number the Orders screen shows; recomputing it here could make the
 *    drawer figure disagree with the receipts. Where the lines *don't*
 *    add up to it, `mismatchedTotalCount` says so instead.
 * 2. **Voided orders are counted, never totalled.** They're excluded from
 *    `total`, `cashTotal`, `promptPayTotal` and the per-product rows, and
 *    reported separately, so a voided sale can't quietly inflate the
 *    day's takings but also can't vanish without trace.
 * 3. **Every order is re-filtered by its *parsed* instant** against
 *    `localDayRange(day)`, not trusted to be in range because the caller
 *    said so. `ordersForDay` selects by *string* comparison on the
 *    `createdAt` index, so an odd-but-parseable timestamp (e.g. one with
 *    an explicit numeric offset rather than `Z`) could sort into a range
 *    it doesn't belong in; it must not land in the wrong day's takings.
 *
 * The blind spot from task 6 stands and is worth restating here: an order
 * whose `createdAt` isn't a Z-normalised ISO string is invisible to the
 * indexed read in `ordersForDay`, so it never reaches this function at
 * all. It therefore appears in no day's report and in no count here —
 * not even `invalidCount`, which can only count records it was given.
 */
export function buildZReport(orders: unknown[], day: Date = new Date()): ZReport {
  // An unusable `day` would make `localDayRange` throw on `toISOString()`.
  // The screen only ever passes a `parseLocalDayKey` result, but "never
  // throws" has to hold for every caller, including task 9's server.
  const dayTime = day instanceof Date ? day.getTime() : Number.NaN
  if (!Number.isFinite(dayTime)) return emptyReport('')

  const dayKey = localDayKey(day)
  const { startISO, endISO } = localDayRange(day)
  const startMs = new Date(startISO).getTime()
  const endMs = new Date(endISO).getTime()

  const { valid, invalid } = partitionOrders(Array.isArray(orders) ? orders : [])
  const report = emptyReport(dayKey)
  report.invalidCount = invalid.length
  const products = new Map<string, ZReportProduct>()

  for (const order of valid) {
    const at = new Date(order.createdAt).getTime()
    if (!(at >= startMs && at < endMs)) continue

    if (order.status === 'voided') {
      if (!isSafeSum(report.voidedTotal, order.total)) {
        report.invalidCount++
        continue
      }
      report.voidedCount++
      report.voidedTotal += order.total
      continue
    }

    // A running total past MAX_SAFE_INTEGER stops being exact money, so
    // the order that would push it there is dropped and counted as
    // unreadable — the same "first ones win" rule `partitionCartLines`
    // applies to a cart.
    if (!isSafeSum(report.total, order.total)) {
      report.invalidCount++
      continue
    }
    report.orderCount++
    report.total += order.total
    if (order.payment.method === 'cash') {
      report.cashTotal += order.total
    } else {
      report.promptPayTotal += order.total
    }

    const rawLines: CartLine[] = Array.isArray(order.lines) ? order.lines : []
    const { valid: validLines, invalid: invalidLines } = partitionCartLines(rawLines)
    let mismatched = invalidLines.length > 0 || cartTotal(validLines) !== order.total

    for (const line of validLines) {
      const existing = products.get(line.productId)
      const units = (existing?.units ?? 0) + line.qty
      const revenue = (existing?.revenue ?? 0) + lineTotal(line)
      if (!Number.isSafeInteger(units) || !Number.isSafeInteger(revenue)) {
        mismatched = true
        continue
      }
      products.set(line.productId, {
        productId: line.productId,
        // Keep the first snapshot name seen for this product, so a later
        // rename mid-day doesn't retitle the earlier sales.
        name: existing?.name ?? line.name,
        units,
        revenue,
      })
    }

    if (mismatched) report.mismatchedTotalCount++
  }

  report.products = [...products.values()].sort(
    (a, b) =>
      b.revenue - a.revenue ||
      b.units - a.units ||
      a.name.localeCompare(b.name) ||
      a.productId.localeCompare(b.productId),
  )
  return report
}

/**
 * The Z report as plain text, for the Share/Copy button. Kept next to
 * `buildZReport` (and free of React) so the wording is testable as one
 * exact string rather than scraped out of the DOM.
 */
export function formatZReport(report: ZReport, shopName: string): string {
  const lines = [
    `${shopName} — Z report`,
    report.dayKey,
    '',
    `Orders: ${report.orderCount}`,
    `Total: ${formatBaht(report.total)}`,
    `Cash: ${formatBaht(report.cashTotal)}`,
    `PromptPay: ${formatBaht(report.promptPayTotal)}`,
    `Cash expected in drawer: ${formatBaht(report.cashTotal)}`,
    '',
    'Items',
  ]

  if (report.products.length === 0) {
    lines.push('None')
  } else {
    for (const product of report.products) {
      lines.push(`${product.name} × ${product.units} — ${formatBaht(product.revenue)}`)
    }
  }

  if (report.voidedCount > 0) {
    lines.push('', `Voided: ${report.voidedCount} — ${formatBaht(report.voidedTotal)} (excluded)`)
  }
  if (report.invalidCount > 0) {
    lines.push('', `Orders that couldn't be read: ${report.invalidCount}`)
  }
  if (report.mismatchedTotalCount > 0) {
    lines.push('', `Orders with an incomplete item list: ${report.mismatchedTotalCount}`)
  }

  return lines.join('\n')
}
