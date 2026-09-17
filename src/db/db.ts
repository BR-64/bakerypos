import Dexie, { type EntityTable } from 'dexie'
import type { Order, Product } from '../domain/types'

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

  constructor(name = 'bakery-pos') {
    super(name)
    this.version(1).stores({
      // Only indexed fields are listed; the full object is stored regardless.
      // Booleans (archived, outOfStock) cannot be indexed in IndexedDB — filter in JS.
      products: 'id, category, sortOrder',
      orders: 'id, number, createdAt, status, sync',
    })
  }
}

export const db = new PosDatabase()
