import { v4 as uuid } from 'uuid'
import { cartTotal } from '../domain/money'
import type { CartLine, Order, Payment } from '../domain/types'
import { db, type PosDatabase } from './db'

/**
 * Create a completed order from the cart. Runs in one transaction so the
 * running order number can never be duplicated on this device.
 */
export async function completeOrder(
  lines: CartLine[],
  payment: Payment,
  database: PosDatabase = db,
): Promise<Order> {
  if (lines.length === 0) throw new Error('Cannot complete an empty order')
  const total = cartTotal(lines)
  if (payment.method === 'cash' && payment.tendered - payment.change !== total) {
    throw new Error('Cash payment does not balance with order total')
  }

  return database.transaction('rw', database.orders, async () => {
    const last = await database.orders.orderBy('number').last()
    const order: Order = {
      id: uuid(),
      number: (last?.number ?? 0) + 1,
      lines: lines.map((l) => ({ ...l })),
      total,
      payment,
      status: 'completed',
      createdAt: new Date().toISOString(),
      sync: 'pending',
    }
    await database.orders.add(order)
    return order
  })
}

/** Void an order. It stays in the DB (and in the Z report, under "voided"). */
export async function voidOrder(
  id: string,
  reason: string,
  database: PosDatabase = db,
): Promise<void> {
  const n = await database.orders.update(id, {
    status: 'voided',
    voidedAt: new Date().toISOString(),
    voidReason: reason,
    sync: 'pending',
  })
  if (n === 0) throw new Error(`Order ${id} not found`)
}
