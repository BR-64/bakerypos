import { useCallback, useMemo, useState } from 'react'
import * as cart from '../domain/cart'
import { cartTotal } from '../domain/money'
import type { CartLine, Product } from '../domain/types'

/**
 * In-memory cart for the current sale. Wraps the pure functions in
 * `src/domain/cart.ts` in React state — no Dexie, no network, no
 * persistence, so it works the same in airplane mode.
 */
export function useCart() {
  const [lines, setLines] = useState<CartLine[]>([])

  // `addProduct` throws for a genuinely new line with a non-integer price.
  // React can run updaters during render (e.g. under StrictMode or when
  // actions are batched), and there is no error boundary around a state
  // updater's own execution, so that throw must never escape here — catch
  // it inside the updater itself rather than pre-checking a ref, which can
  // go stale when several actions run in the same batch.
  const add = useCallback((product: Product) => {
    setLines((prev) => {
      try {
        return cart.addProduct(prev, product)
      } catch (e) {
        console.error(
          `useCart.add: refusing to add product "${product.id}" — price ${product.price} is not integer satang`,
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
