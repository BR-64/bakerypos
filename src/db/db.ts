import Dexie, { type EntityTable } from 'dexie'
import type { Settings } from '../domain/settings'
import type { Order, Product, StockMovement } from '../domain/types'

/**
 * Local-first store. Everything the kiosk needs lives here; the server is a
 * backup that receives orders via sync (see docs/PLAN.md task 8).
 *
 * Schema rules:
 * - Bump the version number and add a new `.version(n).stores(...)` block for
 *   any change. Never edit an existing version block — devices in the field
 *   already have that schema.
 */
export class PosDatabase extends Dexie {
  products!: EntityTable<Product, 'id'>
  orders!: EntityTable<Order, 'id'>
  settings!: EntityTable<Settings, 'id'>
  stockMovements!: EntityTable<StockMovement, 'id'>

  constructor(name = 'bakery-pos') {
    super(name)
    this.version(1).stores({
      // Only indexed fields are listed; the full object is stored regardless.
      // Booleans (archived, outOfStock) cannot be indexed in IndexedDB — filter in JS.
      //
      // `Product.image` (the Admin photo) is therefore stored here with no
      // version bump and no upgrade: it is unindexed, nothing queries by
      // it, and a row saved before pictures existed simply has no such
      // property — which is the same "no picture" state as a row that
      // never gets one. A new `.version(n)` would be required only if it
      // ever needed an index, which a Blob cannot have anyway.
      products: 'id, category, sortOrder',
      orders: 'id, number, createdAt, status, sync',
    })
    // v2 (task 7a): the singleton `settings` row — shop name and PromptPay ID.
    //
    // `products` and `orders` are deliberately NOT re-listed here. Dexie
    // carries every store forward from the previous version untouched, and
    // re-listing them would mean re-typing their index strings, where a
    // single typo (e.g. dropping `createdAt`) would silently delete an index
    // that `ordersForDay`/`todaysOrders` depend on — on every device in the
    // field, with no error anywhere.
    //
    // No `upgrade()` callback: adding a store needs no data transformation,
    // and existing rows in the other stores are not touched. A device on v1
    // opens straight into v2 with all its data intact and an empty
    // `settings` table; `getSettings` falls back to `DEFAULT_SETTINGS` until
    // the first save creates the row.
    this.version(2).stores({
      settings: 'id',
    })
    // v3 (task 8d): the append-only stock history.
    //
    // The count itself is `Product.stock`, unindexed on the v1 `products`
    // store like `image`, so `products` needs no new version. As in v2, the
    // existing stores are not re-listed (a re-typed index string is a silent
    // index loss on every device). No `upgrade()`: every product on an
    // upgraded device simply has no `stock` key, i.e. is untracked.
    //
    // `orderId` finds a sale's movements when it is voided;
    // `[productId+createdAt]` is Admin's per-product history, newest first.
    this.version(3).stores({
      stockMovements: 'id, orderId, [productId+createdAt]',
    })
  }
}

export const db = new PosDatabase()
