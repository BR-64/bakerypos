import type { CartLine, Product } from './types'

/**
 * Whether a value that should be a boolean (`archived`, `outOfStock`) is
 * actually a boolean, or simply absent. A record that carries the field
 * with a non-boolean value (e.g. the string `"false"`) is corrupt data, not
 * "falsy" — callers must never guess truthiness for these fields, only
 * check `=== true`.
 */
function isBooleanOrAbsent(value: unknown): boolean {
  return typeof value === 'boolean' || typeof value === 'undefined'
}

/**
 * Whether `product` is well-formed enough to sell. The Sell screen must
 * never crash or misbehave on bad data (CLAUDE.md: "Invalid product or
 * order data is skipped and logged, never thrown"), so this is the single
 * source of truth for what counts as invalid:
 *
 * - `id` missing or not a non-empty string
 * - `name` missing, empty/whitespace-only, or not a string
 * - `price` not a non-negative integer (satang) — zero is allowed (a free
 *   item isn't forbidden by the spec)
 * - `sortOrder` not a finite number
 * - `archived` / `outOfStock` present but not a boolean (e.g. `"false"`) —
 *   absent is fine and treated as `false` elsewhere, via `=== true` checks
 */
export function isSellable(product: Product): boolean {
  return (
    typeof product.id === 'string' &&
    product.id.length > 0 &&
    typeof product.name === 'string' &&
    product.name.trim().length > 0 &&
    Number.isInteger(product.price) &&
    product.price >= 0 &&
    Number.isFinite(product.sortOrder) &&
    isBooleanOrAbsent(product.archived) &&
    isBooleanOrAbsent(product.outOfStock)
  )
}

export interface PartitionedProducts {
  /** Well-formed products, safe to render and add to the cart. */
  sellable: Product[]
  /** Invalid records — never rendered, only logged (see `isSellable`). */
  invalid: Product[]
}

/**
 * Splits `products` into the well-formed ones and the invalid ones. The
 * Sell screen renders only `sellable` and logs each `invalid` product once
 * (see `src/screens/SellScreen.tsx`) — invalid data is skipped, not shown
 * disabled, and never thrown.
 */
export function partitionSellable(products: Product[]): PartitionedProducts {
  const sellable: Product[] = []
  const invalid: Product[] = []
  for (const product of products) {
    ;(isSellable(product) ? sellable : invalid).push(product)
  }
  return { sellable, invalid }
}

/**
 * Add one unit of `product` to the cart. If the product is already in the
 * cart, bumps that line's qty by 1 — the line keeps its original snapshot
 * (name/unitPrice) even if the product's price has since changed. Never
 * mutates `lines`.
 *
 * Archived or out-of-stock products (checked with `=== true`, never
 * truthiness) are always a no-op — returns `lines` unchanged, same
 * reference — even when the product already has a line in the cart: a
 * product that's since been archived or gone out of stock must never bump
 * its existing line either. This check runs before the existing-line
 * lookup, so it applies unconditionally.
 *
 * A product that fails the rest of `isSellable` (bad price/name/etc.) is
 * only a no-op when it would start a genuinely *new* line — bumping an
 * existing line reuses its stored snapshot price/name and skips that
 * check, so a product that's since been repriced or renamed to something
 * invalid still bumps correctly at its original snapshot. Neither case
 * throws; the grid should already prevent tapping these, but a stale tile
 * or a direct call must never crash the sale.
 */
export function addProduct(lines: CartLine[], product: Product): CartLine[] {
  if (product.archived === true || product.outOfStock === true) return lines
  const existing = lines.find((l) => l.productId === product.id)
  if (existing) {
    return lines.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + 1 } : l))
  }
  if (!isSellable(product)) return lines
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

/** Total number of items in the cart (sum of qty across lines). */
export function itemCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.qty, 0)
}
