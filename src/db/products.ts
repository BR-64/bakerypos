import type { Product } from '../domain/types'
import { db, type PosDatabase } from './db'

/**
 * Products available for sale, sorted for the Sell screen grid. Archived
 * products are filtered out (booleans are not indexable in IndexedDB, so
 * this happens in JS after the index scan) but out-of-stock products are
 * kept — the grid still shows them, disabled, in their normal position.
 */
export async function sellableProducts(database: PosDatabase = db): Promise<Product[]> {
  return database.products
    .orderBy('sortOrder')
    .filter((p) => !p.archived)
    .toArray()
}
