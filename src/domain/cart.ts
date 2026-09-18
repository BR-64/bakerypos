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
