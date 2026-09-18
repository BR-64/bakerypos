import { useCallback, useMemo, useRef, useState } from 'react'
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
  // Mirrors `lines` for `add` to read synchronously, updated alongside every
  // `setLines` call below (never read or written during render itself).
  // `addProduct`'s throw for an invalid new-line price must never happen
  // inside a `setLines` updater — React can run updaters during render, and
  // there is no error boundary, so that throw would unmount the whole app
  // mid-sale. Checking `canAddProduct` against this ref before calling
  // `setLines` keeps `add` itself throw-free.
  const linesRef = useRef(lines)

  const add = useCallback((product: Product) => {
    if (!cart.canAddProduct(linesRef.current, product)) {
      console.error(
        `useCart.add: refusing to add product "${product.id}" — price ${product.price} is not integer satang`,
      )
      return
    }
    setLines((prev) => {
      const next = cart.addProduct(prev, product)
      linesRef.current = next
      return next
    })
  }, [])

  const increment = useCallback((productId: string) => {
    setLines((prev) => {
      const next = cart.increment(prev, productId)
      linesRef.current = next
      return next
    })
  }, [])

  const decrement = useCallback((productId: string) => {
    setLines((prev) => {
      const next = cart.decrement(prev, productId)
      linesRef.current = next
      return next
    })
  }, [])

  const remove = useCallback((productId: string) => {
    setLines((prev) => {
      const next = cart.remove(prev, productId)
      linesRef.current = next
      return next
    })
  }, [])

  const clear = useCallback(() => {
    const next = cart.clear()
    linesRef.current = next
    setLines(next)
  }, [])

  const total = useMemo(() => cartTotal(lines), [lines])
  const count = useMemo(() => cart.itemCount(lines), [lines])

  return { lines, total, count, add, increment, decrement, remove, clear }
}
