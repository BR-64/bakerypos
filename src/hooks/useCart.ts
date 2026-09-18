import { useCallback, useMemo, useState } from 'react'
import * as cart from '../domain/cart'
import { safeString } from '../domain/log'
import { cartTotal } from '../domain/money'
import type { CartLine, Product } from '../domain/types'
import { useLogInvalidOnce } from './useLogInvalidOnce'

/**
 * Reads `key` off a value that's supposed to be a `CartLine` but, since
 * cart lines can be corrupt (see `isValidCartLine`), might not even be an
 * object. Never throws.
 */
function field(line: CartLine, key: string): unknown {
  return line && typeof line === 'object'
    ? (line as unknown as Record<string, unknown>)[key]
    : undefined
}

/** Dedup key for an invalid cart line: its productId when present, otherwise a stringified copy. */
function invalidCartLineKey(line: CartLine): string {
  const productId = field(line, 'productId')
  return typeof productId === 'string' && productId.length > 0 ? productId : safeString(line)
}

function describeInvalidCartLine(line: CartLine): string {
  return (
    `useCart: skipping invalid cart line ${invalidCartLineKey(line)} — ` +
    `productId=${safeString(field(line, 'productId'))}, name=${safeString(field(line, 'name'))}, ` +
    `unitPrice=${safeString(field(line, 'unitPrice'))}, qty=${safeString(field(line, 'qty'))}`
  )
}

/**
 * The subset of `lines` that every action should actually operate on:
 * well-formed, de-duplicated by `productId` (see `partitionCartLines`).
 *
 * Returns `lines` itself (same reference) when nothing is invalid, so a
 * true no-op action (e.g. incrementing an unknown productId) still leaves
 * the exposed `lines` referentially unchanged — this is the same
 * "same-reference when nothing invalid" rule `useCart` applies to what it
 * exposes, reused here for what actions consume.
 *
 * This matters because a *raw* invalid line is still a real element of the
 * state array: `increment`/`decrement`/`remove` look up lines by
 * `productId` and don't know an entry is corrupt, so operating on the raw
 * array can silently resurrect garbage (e.g. bumping a stray `qty: 0` line
 * back into validity) or, worse, crash outright (`.productId` on a `null`
 * entry). Cleaning first means every action only ever touches data that
 * was already validated and logged.
 */
function cleanLines(lines: CartLine[]): CartLine[] {
  const { valid, invalid } = cart.partitionCartLines(lines)
  return invalid.length === 0 ? lines : valid
}

/**
 * In-memory cart for the current sale. Wraps the pure functions in
 * `src/domain/cart.ts` in React state — no Dexie, no network, no
 * persistence, so it works the same in airplane mode.
 *
 * Call this once in `App` and pass the result down as a prop; calling it
 * again in a screen creates a second, independent cart.
 *
 * The raw state can carry corrupt lines (seeded via `initialLines`, or in
 * principle reached some other way in future); `lines` exposes only the
 * well-formed, de-duplicated ones (`partitionCartLines(raw).valid`), and
 * each invalid line — including every repeat of a `productId` already kept
 * — is logged once via `useLogInvalidOnce` — skipped and logged, never
 * thrown or shown, per CLAUDE.md. When nothing is invalid, `lines` is the
 * *same reference* as the raw state array, so the existing same-reference
 * tests (e.g. a no-op `add`) keep working unchanged.
 *
 * Every action (`add`/`increment`/`decrement`/`remove`) runs on
 * `cleanLines(prev)`, never on the raw state directly, so invalid raw
 * lines are dropped the moment any action runs (after already having been
 * logged once on render) instead of being available for a domain function
 * to accidentally look up, bump, or remove alongside a same-id valid line.
 */
export function useCart(initialLines: CartLine[] = []) {
  const [rawLines, setLines] = useState<CartLine[]>(initialLines)

  const { valid, invalid } = useMemo(() => cart.partitionCartLines(rawLines), [rawLines])
  const lines = invalid.length === 0 ? rawLines : valid

  useLogInvalidOnce(invalid, invalidCartLineKey, describeInvalidCartLine)

  // `addProduct` no longer throws for expected bad-data cases (it returns
  // `lines` unchanged for a product that fails `isSellable`) — the Sell
  // screen never even wires up `onAdd` for those, since it renders only
  // sellable products. This try/catch is a last-resort guard against a
  // genuinely unexpected exception elsewhere in `addProduct`, kept because
  // React can run updaters during render (e.g. under StrictMode or when
  // actions are batched) and there's no error boundary around a state
  // updater's own execution — such a throw must never escape here.
  // `safeString` keeps the log message itself from throwing, since
  // `product` may be an untrusted, possibly-corrupt record.
  const add = useCallback((product: Product) => {
    setLines((prev) => {
      try {
        return cart.addProduct(cleanLines(prev), product)
      } catch (e) {
        console.error(
          `useCart.add: unexpected error adding product "${safeString(product.id)}" (price=${safeString(product.price)})`,
          e,
        )
        return prev
      }
    })
  }, [])

  const increment = useCallback((productId: string) => {
    setLines((prev) => cart.increment(cleanLines(prev), productId))
  }, [])

  const decrement = useCallback((productId: string) => {
    setLines((prev) => cart.decrement(cleanLines(prev), productId))
  }, [])

  const remove = useCallback((productId: string) => {
    setLines((prev) => cart.remove(cleanLines(prev), productId))
  }, [])

  // Resets the raw state to [], which also drops any corrupt raw lines.
  const clear = useCallback(() => {
    setLines(cart.clear())
  }, [])

  // `cartTotal` (money.ts) is deliberately unguarded — it trusts its
  // input — but `lines` is always safe to sum: `partitionCartLines` keeps
  // a running total as it builds `valid` and rejects any line that would
  // push it past `Number.MAX_SAFE_INTEGER` (see its doc comment), so an
  // overflowing line never reaches `lines` in the first place. `total`
  // therefore always equals the exact sum of the visible lines — no
  // fallback, nothing to log here.
  const total = useMemo(() => cartTotal(lines), [lines])
  const count = useMemo(() => cart.itemCount(lines), [lines])

  return { lines, total, count, add, increment, decrement, remove, clear }
}

export type Cart = ReturnType<typeof useCart>
