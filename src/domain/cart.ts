import type { CartLine, Product } from './types'

/**
 * Add one unit of `product` to the cart. If the product is already in the
 * cart, bumps that line's qty by 1 — the line keeps its original snapshot
 * (name/unitPrice) even if the product's price has since changed. Never
 * mutates `lines`.
 *
 * Archived or out-of-stock products are a no-op (returns `lines` unchanged,
 * same reference) rather than throwing — the grid should already prevent
 * tapping them, but a stale tile shouldn't crash the sale.
 *
 * The price is only validated when it would be snapshotted onto a *new*
 * line: bumping an existing line reuses its stored snapshot price, so a
 * product that has since been repriced to something invalid must not stop
 * the bump. A non-integer price on a genuinely new line is a data bug, so
 * that still throws — callers that can't tolerate a throw (e.g. inside a
 * React state updater) should check `canAddProduct` first.
 */
export function addProduct(lines: CartLine[], product: Product): CartLine[] {
  if (product.archived || product.outOfStock) return lines
  const existing = lines.find((l) => l.productId === product.id)
  if (existing) {
    return lines.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l))
  }
  if (!Number.isInteger(product.price)) {
    throw new Error('Product price must be integer satang')
  }
  return [...lines, { productId: product.id, name: product.name, unitPrice: product.price, qty: 1 }]
}

/**
 * Whether `addProduct(lines, product)` is safe to call, i.e. it will not
 * throw. Archived/out-of-stock products and products already in the cart
 * are always safe (the latter reuses its snapshot price); a product that
 * would start a new line is only safe if its current price is integer
 * satang. Callers that must not throw mid-update (e.g. a React state
 * updater) should check this first and skip the call otherwise.
 */
export function canAddProduct(lines: CartLine[], product: Product): boolean {
  if (product.archived || product.outOfStock) return true
  const existing = lines.some((l) => l.productId === product.id)
  if (existing) return true
  return Number.isInteger(product.price)
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

/** Total number of items in the cart (sum of qty across lines). */
export function itemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0)
}
