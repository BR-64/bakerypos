import { beforeEach, describe, expect, it } from 'vitest'
import { addProduct } from '../domain/cart'
import { cartTotal } from '../domain/money'
import { PosDatabase } from './db'
import { completeOrder, voidOrder } from './orders'
import { seedProducts } from './seed'

let database: PosDatabase

beforeEach(async () => {
  // Fresh DB per test; fake-indexeddb is loaded in src/test/setup.ts
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

const croissant = { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }

describe('completeOrder', () => {
  it('stores a cash order with snapshot prices and a running number', async () => {
    const o1 = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 20000, change: 9000 },
      database,
    )
    const o2 = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 11000, change: 0 },
      database,
    )
    expect(o1.number).toBe(1)
    expect(o2.number).toBe(2)
    expect(o1.total).toBe(11000)
    expect(o1.status).toBe('completed')
    expect(o1.sync).toBe('pending')
    expect(await database.orders.count()).toBe(2)
  })

  it('rejects an empty cart', async () => {
    await expect(
      completeOrder([], { method: 'cash', tendered: 0, change: 0 }, database),
    ).rejects.toThrow('empty')
  })

  it('rejects cash that does not balance', async () => {
    await expect(
      completeOrder([croissant], { method: 'cash', tendered: 10000, change: 0 }, database),
    ).rejects.toThrow('balance')
  })

  it('accepts a promptpay order', async () => {
    const o = await completeOrder(
      [croissant],
      { method: 'promptpay', confirmedAt: new Date().toISOString() },
      database,
    )
    expect(o.payment.method).toBe('promptpay')
  })

  it('keeps the snapshot price even after the product is repriced in the db, between adding to the cart and completing the order', async () => {
    const seedProduct = seedProducts.find((p) => p.id === 'p-croissant')!
    await database.products.add(seedProduct)
    const originalPrice = seedProduct.price

    // First unit added at the original price...
    let lines = addProduct([], seedProduct)

    // ...then the product is repriced in the db...
    const repriced = { ...seedProduct, price: originalPrice + 10000 }
    await database.products.update(seedProduct.id, { price: repriced.price })

    // ...and a second unit is added using the repriced product object.
    // `addProduct` must still snapshot the existing line's original price
    // when bumping qty, not the new (repriced) price.
    lines = addProduct(lines, repriced)
    expect(lines).toEqual([
      { productId: seedProduct.id, name: seedProduct.name, unitPrice: originalPrice, qty: 2 },
    ])

    const order = await completeOrder(
      lines,
      { method: 'cash', tendered: cartTotal(lines), change: 0 },
      database,
    )

    const stored = await database.orders.get(order.id)
    expect(stored?.lines[0].unitPrice).toBe(originalPrice)
    expect(stored?.lines[0].qty).toBe(2)
    expect(stored?.total).toBe(cartTotal(lines))
    // Sanity check the repriced value was never used.
    expect(stored?.total).not.toBe(cartTotal([{ ...lines[0], unitPrice: repriced.price }]))
  })
})

describe('voidOrder', () => {
  it('marks the order voided without deleting it', async () => {
    const o = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 11000, change: 0 },
      database,
    )
    await voidOrder(o.id, 'customer changed mind', database)
    const stored = await database.orders.get(o.id)
    expect(stored?.status).toBe('voided')
    expect(stored?.voidReason).toBe('customer changed mind')
    expect(await database.orders.count()).toBe(1)
  })

  it('throws for an unknown id', async () => {
    await expect(voidOrder('nope', 'x', database)).rejects.toThrow('not found')
  })
})
