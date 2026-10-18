import Dexie from 'dexie'
import { v4 as uuid } from 'uuid'
import {
  MAX_STOCK_INPUT,
  planStockChanges,
  readStock,
  saleQuantities,
  voidStockDeltas,
  type StockPlan,
  type StockSkip,
} from '../domain/stock'
import type { Order, StockMovement } from '../domain/types'
import { db, type PosDatabase } from './db'

/**
 * Stock (task 8d). Admin's two writes, the history read, and the two
 * helpers `completeOrder`/`voidOrder` call inside their own transaction.
 *
 * Every write is `products.update` (never `put`, so nothing else on the row
 * — name, price, photo — can be clobbered by a stale copy) plus one
 * appended `StockMovement`, in one `rw` transaction over both tables, with
 * the product re-read inside it. IndexedDB serialises overlapping `rw`
 * transactions on the same stores, so a sale and a "+ Received" can never
 * lose each other's change.
 */

function isCount(value: unknown, min: number): value is number {
  return (
    Number.isSafeInteger(value) && (value as number) >= min && (value as number) <= MAX_STOCK_INPUT
  )
}

/**
 * Admin's "Set count" — a stocktake. Starts tracking an untracked product,
 * and is the repair path for an unreadable count (`previous: null`,
 * `delta = count`). Setting the same value again still logs a delta-0
 * movement, so the history shows the count was checked.
 *
 * Rejects a count outside 0..`MAX_STOCK_INPUT` and a missing product.
 * Archived products are allowed.
 */
export async function setStockCount(
  id: string,
  count: number,
  database: PosDatabase = db,
): Promise<StockMovement> {
  if (!isCount(count, 0)) {
    throw new Error(`Stock count must be a whole number from 0 to ${MAX_STOCK_INPUT}`)
  }
  return database.transaction('rw', database.products, database.stockMovements, async () => {
    const row = await database.products.get(id)
    if (row === undefined) throw new Error(`Product ${id} not found`)
    const reading = readStock(row)
    // A tracked level so far out (only corrupt data) that the delta would be
    // unsafe is logged like an unreadable one, so the movement stays valid.
    const previous =
      reading.kind === 'tracked' && Number.isSafeInteger(count - reading.level)
        ? reading.level
        : null
    const movement: StockMovement = {
      id: uuid(),
      productId: id,
      kind: 'set',
      delta: count - (previous ?? 0),
      level: count,
      previous,
      createdAt: new Date().toISOString(),
    }
    await database.products.update(id, { stock: count })
    await database.stockMovements.add(movement)
    return movement
  })
}

/**
 * Admin's "+ Received" — a delivery of `qty` (1..`MAX_STOCK_INPUT`).
 * Rejects a missing product and one that is untracked or unreadable
 * ("Set a count first": adding to a count nobody has taken would invent
 * one). Archived products are allowed.
 */
export async function receiveStock(
  id: string,
  qty: number,
  database: PosDatabase = db,
): Promise<StockMovement> {
  if (!isCount(qty, 1)) {
    throw new Error(`Received quantity must be a whole number from 1 to ${MAX_STOCK_INPUT}`)
  }
  return database.transaction('rw', database.products, database.stockMovements, async () => {
    const row = await database.products.get(id)
    if (row === undefined) throw new Error(`Product ${id} not found`)
    const reading = readStock(row)
    if (reading.kind !== 'tracked') throw new Error('Set a count first')
    const level = reading.level + qty
    if (!Number.isSafeInteger(level)) throw new Error('That would make the count too large')
    const movement: StockMovement = {
      id: uuid(),
      productId: id,
      kind: 'received',
      delta: qty,
      level,
      previous: reading.level,
      createdAt: new Date().toISOString(),
    }
    await database.products.update(id, { stock: level })
    await database.stockMovements.add(movement)
    return movement
  })
}

/**
 * The latest `limit` movements for one product, newest first, read through
 * the `[productId+createdAt]` index. Rows come back as stored — the screen
 * runs them through `partitionStockMovements` before showing them.
 */
export async function stockHistory(
  id: string,
  database: PosDatabase = db,
  limit = 50,
): Promise<StockMovement[]> {
  return database.stockMovements
    .where('[productId+createdAt]')
    .between([id, Dexie.minKey], [id, Dexie.maxKey])
    .reverse()
    .limit(limit)
    .toArray()
}

/**
 * `{ orderNumber }` only when the order's number is a safe integer >= 1. A
 * corrupt number is left off rather than copied, so the movement stays valid
 * (and a later void can still find and reverse it).
 */
function orderNumberField(order: Order): { orderNumber?: number } {
  return Number.isSafeInteger(order.number) && order.number >= 1
    ? { orderNumber: order.number }
    : {}
}

/** Carry out a checked plan. Only Dexie is awaited, so the caller's transaction stays open. */
async function writePlan(database: PosDatabase, plan: StockPlan): Promise<void> {
  for (const update of plan.updates) {
    await database.products.update(update.id, { stock: update.stock })
  }
  if (plan.movements.length > 0) await database.stockMovements.bulkAdd(plan.movements)
}

/**
 * For `completeOrder` only, inside its transaction (which must include
 * `products` and `stockMovements`): take each tracked product's sold
 * quantity off its count and log a `sale` movement dated like the order.
 * Returns what was skipped for bad data, for the caller to log after
 * commit. A failing write rejects, aborting the order with it.
 */
export async function applySaleStock(database: PosDatabase, order: Order): Promise<StockSkip[]> {
  const sold = saleQuantities(order.lines)
  if (sold.size === 0) return []
  const ids = [...sold.keys()]
  const rows = await database.products.bulkGet(ids)
  const deltas = new Map([...sold].map(([id, qty]) => [id, -qty]))
  const plan = planStockChanges({
    rows: new Map(ids.map((id, i) => [id, rows[i]])),
    deltas,
    kind: 'sale',
    at: order.createdAt,
    newId: uuid,
    orderId: order.id,
    ...orderNumberField(order),
  })
  await writePlan(database, plan)
  return plan.skipped
}

/**
 * For `voidOrder` only, inside its transaction: add back exactly what this
 * order's `sale` movements took off, and log a `void` movement per product.
 * Nothing at all if the order was sold while untracked (no sale movements)
 * or a `void` movement for it already exists. `order.voidedAt` dates the
 * movements. Returns what was skipped, for logging after commit.
 */
export async function applyVoidStock(database: PosDatabase, order: Order): Promise<StockSkip[]> {
  const recorded = await database.stockMovements.where('orderId').equals(order.id).toArray()
  const { alreadyVoided, deltas, skipped } = voidStockDeltas(recorded)
  if (alreadyVoided || deltas.size === 0) return skipped
  const ids = [...deltas.keys()]
  const rows = await database.products.bulkGet(ids)
  const plan = planStockChanges({
    rows: new Map(ids.map((id, i) => [id, rows[i]])),
    deltas,
    kind: 'void',
    at: order.voidedAt ?? new Date().toISOString(),
    newId: uuid,
    orderId: order.id,
    ...orderNumberField(order),
  })
  await writePlan(database, plan)
  return [...skipped, ...plan.skipped]
}
