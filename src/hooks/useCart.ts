import { useCallback, useMemo, useState } from 'react'
import * as cart from '../domain/cart'
import { safeString } from '../domain/log'
import { cartTotal } from '../domain/money'
import type { CartLine, Product } from '../domain/types'

/**
 * In-memory cart for the current sale. Wraps the pure functions in
 * `src/domain/cart.ts` in React state — no Dexie, no network, no
 * persistence, so it works the same in airplane mode.
 *
 * Call this once in `App` and pass the result down as a prop; calling it
 * again in a screen creates a second, independent cart.
 */
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([])

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

  const clear = useCallback(() => {
    setLines(cart.clear())
  }, [])

  const total = useMemo(() => cartTotal(lines), [lines])
  const count = useMemo(() => cart.itemCount(lines), [lines])

  return { lines, total, count, add, increment, decrement, remove, clear }
}

export type Cart = ReturnType<typeof useCart>
