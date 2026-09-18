import type { CartLine, Product } from './types'

/**
 * Add one unit of `product` to the cart. If the product is already in the
 * cart, bumps that line's qty by 1 — the line keeps its original snapshot
 * (name/unitPrice) even if the product's price has since changed. Never
 * mutates `lines`.
 */
export function addProduct(lines: CartLine[], product: Product): CartLine[] {
  const existing = lines.find((l) => l.productId === product.id)
  if (existing) {
    return lines.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l))
  }
  return [...lines, { productId: product.id, name: product.name, unitPrice: product.price, qty: 1 }]
}

/**
 * Bump a line's qty by 1. Unknown productId returns `lines` unchanged (same
 * reference).
 */
export function increment(lines: CartLine[], productId: string): CartLine[] {
  if (!lines.some((l) => l.productId === productId)) return lines
  return lines.map((l) => (l.productId === productId ? { ...l, qty: l.qty + 1 } : l))
}

/**
 * Drop a line's qty by 1, removing the line once it reaches 0. Unknown
 * productId returns `lines` unchanged (same reference).
 */
export function decrement(lines: CartLine[], productId: string): CartLine[] {
  const line = lines.find((l) => l.productId === productId)
  if (!line) return lines
  if (line.qty <= 1) return lines.filter((l) => l.productId !== productId)
  return lines.map((l) => (l.productId === productId ? { ...l, qty: l.qty - 1 } : l))
}

/** Remove a line entirely. Unknown productId returns `lines` unchanged (same reference). */
export function remove(lines: CartLine[], productId: string): CartLine[] {
  if (!lines.some((l) => l.productId === productId)) return lines
  return lines.filter((l) => l.productId !== productId)
}

/** Empty the cart. */
export function clear(): CartLine[] {
  return []
}
