import { v4 as uuid } from 'uuid'
import { isKnownCategory } from '../domain/categories'
import {
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCT_PRICE,
  type ProductValues,
} from '../domain/productDraft'
import type { Product } from '../domain/types'
import { db, type PosDatabase } from './db'

/** `sortOrder` as a finite number, or `+Infinity` if it isn't one — sorts
 * bad records last instead of letting `Array.prototype.sort` treat NaN
 * comparisons unpredictably. The record itself is still returned (not
 * dropped); `partitionSellable` in `src/domain/cart.ts` is what flags and
 * logs it as invalid, one layer up. */
function sortKey(sortOrder: unknown): number {
  return typeof sortOrder === 'number' && Number.isFinite(sortOrder) ? sortOrder : Infinity
}

/**
 * Products available for sale, sorted for the Sell screen grid.
 *
 * Reads every row with `toArray()` and sorts in JS rather than using
 * `orderBy('sortOrder')`: an IndexedDB index skips any record whose indexed
 * field is missing or not a valid IDB key (e.g. `sortOrder: undefined` or a
 * non-numeric value), which would silently drop that product from the
 * result — invalid data must be surfaced (skipped and logged by the
 * caller), never silently vanish.
 *
 * Archived products are filtered out — booleans are not indexable in
 * IndexedDB, and a non-boolean `archived` must not be read for truthiness,
 * so this uses a strict `=== true` check — but out-of-stock products are
 * kept, so the grid can still show them, disabled, in their normal
 * position.
 */
export async function sellableProducts(database: PosDatabase = db): Promise<Product[]> {
  const all = await database.products.toArray()
  return all
    .filter((p) => p.archived !== true)
    .sort((a, b) => sortKey(a.sortOrder) - sortKey(b.sortOrder))
}

/**
 * Every product, archived ones included, in the same `sortOrder` order the
 * Sell grid uses. For the Admin screen only: archived products are still
 * referenced by old orders and are never deleted, so Admin has to be able
 * to show that they exist rather than leaving the owner wondering where a
 * product went.
 *
 * Same `toArray()`-then-sort-in-JS reasoning as `sellableProducts`: an
 * indexed `orderBy` would silently drop a record with a missing or
 * non-numeric `sortOrder`, and the one screen for fixing bad data must not
 * be the one screen that can't see it.
 */
export async function allProducts(database: PosDatabase = db): Promise<Product[]> {
  const all = await database.products.toArray()
  return all.sort((a, b) => sortKey(a.sortOrder) - sortKey(b.sortOrder))
}

/**
 * Guard for values coming from the Admin form before they are written.
 *
 * `validateProductDraft` (`src/domain/productDraft.ts`) already checks the
 * typed-in strings; this is the last line of defence at the boundary where
 * a price becomes something every future order line is snapshotted from,
 * so it is deliberately duplicated rather than assumed.
 */
function assertProductValues(values: ProductValues): void {
  const { name, price, category } = values
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new Error('A product needs a name')
  }
  if (name.length > MAX_PRODUCT_NAME_LENGTH) {
    throw new Error('Product name is too long')
  }
  if (!Number.isSafeInteger(price) || price < 0 || price > MAX_PRODUCT_PRICE) {
    throw new Error('Product price must be a whole number of satang within range')
  }
  if (!isKnownCategory(category)) {
    throw new Error('Unknown product category')
  }
}

/**
 * Add a product to the menu, at the end of the grid.
 *
 * `sortOrder` is one past the highest existing one (ignoring corrupt
 * values, which `sortKey` already sorts last), computed inside a
 * transaction so two quick adds can't collide on the same position.
 */
export async function createProduct(
  values: ProductValues,
  database: PosDatabase = db,
): Promise<Product> {
  assertProductValues(values)
  return database.transaction('rw', database.products, async () => {
    const existing = await database.products.toArray()
    const highest = existing.reduce(
      (max, p) => (Number.isFinite(p.sortOrder) && p.sortOrder > max ? p.sortOrder : max),
      0,
    )
    const product: Product = {
      id: uuid(),
      name: values.name.trim(),
      price: values.price,
      category: values.category,
      sortOrder: highest + 1,
      outOfStock: false,
      archived: false,
    }
    await database.products.add(product)
    return product
  })
}

/**
 * Change a product's name, price or category.
 *
 * This rewrites only those three fields (`update`, not `put`), so a
 * product's `sortOrder`, stock and archived state survive an edit. It
 * cannot rewrite history: `OrderLine` carries its own `name`/`unitPrice`
 * snapshot taken at the time of sale, and `Order.total` is stored rather
 * than recomputed, so an order placed before this call keeps the price the
 * customer actually paid.
 */
export async function updateProduct(
  id: string,
  values: ProductValues,
  database: PosDatabase = db,
): Promise<void> {
  assertProductValues(values)
  const changed = await database.products.update(id, {
    name: values.name.trim(),
    price: values.price,
    category: values.category,
  })
  if (changed === 0) throw new Error('That product no longer exists')
}

/** Toggle "sold out" — the tile stays in the grid, disabled. */
export async function setProductOutOfStock(
  id: string,
  outOfStock: boolean,
  database: PosDatabase = db,
): Promise<void> {
  if (typeof outOfStock !== 'boolean') throw new Error('outOfStock must be a boolean')
  const changed = await database.products.update(id, { outOfStock })
  if (changed === 0) throw new Error('That product no longer exists')
}

/**
 * Take a product off the menu. **Never a delete** (CLAUDE.md): the row
 * stays so old orders still resolve it, and `sellableProducts` filters it
 * out of the Sell grid with a strict `=== true` check.
 */
export async function archiveProduct(
  id: string,
  archived = true,
  database: PosDatabase = db,
): Promise<void> {
  if (typeof archived !== 'boolean') throw new Error('archived must be a boolean')
  const changed = await database.products.update(id, { archived })
  if (changed === 0) throw new Error('That product no longer exists')
}
