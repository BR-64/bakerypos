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
