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
  return line && typeof line === 'object' ? (line as unknown as Record<string, unknown>)[key] : undefined
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
 * In-memory cart for the current sale. Wraps the pure functions in
 * `src/domain/cart.ts` in React state — no Dexie, no network, no
 * persistence, so it works the same in airplane mode.
 *
 * Call this once in `App` and pass the result down as a prop; calling it
 * again in a screen creates a second, independent cart.
 *
 * The raw state can carry corrupt lines (seeded via `initialLines`, or in
 * principle reached some other way in future); `lines` exposes only the
 * well-formed ones (`partitionCartLines(raw).valid`), and each invalid line
 * is logged once per productId via `useLogInvalidOnce` — skipped and
 * logged, never thrown or shown, per CLAUDE.md. When nothing is invalid,
 * `lines` is the *same reference* as the raw state array, so the existing
 * same-reference tests (e.g. a no-op `add`) keep working unchanged.
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
        return cart.addProduct(prev, product)
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
    setLines((prev) => cart.increment(prev, productId))
  }, [])

  const decrement = useCallback((productId: string) => {
    setLines((prev) => cart.decrement(prev, productId))
  }, [])

  const remove = useCallback((productId: string) => {
    setLines((prev) => cart.remove(prev, productId))
  }, [])

  // Resets the raw state to [], which also drops any corrupt raw lines.
  const clear = useCallback(() => {
    setLines(cart.clear())
  }, [])

  const total = useMemo(() => cartTotal(lines), [lines])
  const count = useMemo(() => cart.itemCount(lines), [lines])

  return { lines, total, count, add, increment, decrement, remove, clear }
}

export type Cart = ReturnType<typeof useCart>
