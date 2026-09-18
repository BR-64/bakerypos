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
 * - `price` not a non-negative safe integer (satang) — zero is allowed (a
 *   free item isn't forbidden by the spec), but a value beyond
 *   `Number.MAX_SAFE_INTEGER` (e.g. `1e18`) is rejected even though
 *   `Number.isInteger` would accept it, since arithmetic on it can silently
 *   lose precision
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
    Number.isSafeInteger(product.price) &&
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

/**
 * Whether `line` is well-formed enough to render and total. Cart lines are
 * React state, not read back from Dexie like products, but CLAUDE.md's
 * "never crash on invalid data" rule applies here too — a corrupt line
 * (e.g. one seeded by a test, or reached via some future import/merge
 * feature) must be skipped and logged, never thrown. `line` is typed as
 * `unknown` rather than `CartLine` because the whole point is that it might
 * not even be an object.
 *
 * - `line` is a non-null object (not an array, not a primitive)
 * - `productId` is a non-empty string
 * - `name` is a string that is non-empty after trimming
 * - `unitPrice` is a safe-integer >= 0 (satang; zero is a valid free item)
 * - `qty` is a safe-integer >= 1 — `Number.isSafeInteger` rather than
 *   `Number.isInteger` for both fields, so an out-of-range value like
 *   `qty: 1e300` (which `Number.isInteger` accepts) is still rejected
 * - `unitPrice * qty` is also a safe integer (guards against a product of
 *   two individually-safe numbers still overflowing)
 */
export function isValidCartLine(line: unknown): line is CartLine {
  if (typeof line !== 'object' || line === null || Array.isArray(line)) return false
  const { productId, name, unitPrice, qty } = line as Record<string, unknown>
  return (
    typeof productId === 'string' &&
    productId.length > 0 &&
    typeof name === 'string' &&
    name.trim().length > 0 &&
    Number.isSafeInteger(unitPrice) &&
    (unitPrice as number) >= 0 &&
    Number.isSafeInteger(qty) &&
    (qty as number) >= 1 &&
    Number.isSafeInteger((unitPrice as number) * (qty as number))
  )
}

export interface PartitionedCartLines {
  /** Well-formed lines, safe to render and total. */
  valid: CartLine[]
  /** Invalid records — never rendered, only logged (see `isValidCartLine`). */
  invalid: CartLine[]
}

/**
 * Splits `lines` into the well-formed ones and the invalid ones, keeping
 * input order within each group. A line that's individually well-formed
 * but repeats a `productId` already kept in `valid` is treated as invalid
 * too — cart lines are keyed by `productId` everywhere downstream
 * (React's list key, and every action's lookup-by-productId), so a
 * duplicate would either render with a colliding key or get silently
 * double-mutated by `increment`/`decrement`. The *first* occurrence wins;
 * later ones are dropped into `invalid` and logged like any other corrupt
 * line. See `useCart`, which exposes only `valid` and logs each `invalid`
 * line once.
 */
export function partitionCartLines(lines: CartLine[]): PartitionedCartLines {
  const valid: CartLine[] = []
  const invalid: CartLine[] = []
  const seenProductIds = new Set<string>()
  for (const line of lines) {
    if (isValidCartLine(line) && !seenProductIds.has(line.productId)) {
      seenProductIds.add(line.productId)
      valid.push(line)
    } else {
      invalid.push(line)
    }
  }
  return { valid, invalid }
}
