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

  const add = useCallback((product: Product) => {
    setLines((prev) => cart.addProduct(prev, product))
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
    setLines(() => cart.clear())
  }, [])

  const total = useMemo(() => cartTotal(lines), [lines])
  const count = useMemo(() => cart.itemCount(lines), [lines])

  return { lines, total, count, add, increment, decrement, remove, clear }
}
