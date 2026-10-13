import { beforeEach, describe, expect, it } from 'vitest'
import { addProduct } from '../domain/cart'
import { cartTotal } from '../domain/money'
import type { Order } from '../domain/types'
import { PosDatabase } from './db'
import { completeOrder, ordersForDay, todaysOrders, voidOrder } from './orders'
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

  it('rejects negative change even when tendered - change balances (฿50 handed over for ฿55)', async () => {
    const one = { ...croissant, qty: 1 } // ฿55
    await expect(
      completeOrder([one], { method: 'cash', tendered: 5000, change: -500 }, database),
    ).rejects.toThrow('non-negative')
    expect(await database.orders.count()).toBe(0)
  })

  it.each([
    ['fractional tendered', { tendered: 11000.5, change: 0.5 }],
    ['negative tendered', { tendered: -1, change: -11001 }],
    ['NaN tendered', { tendered: NaN, change: 0 }],
    ['unsafe tendered', { tendered: 2 ** 53, change: 2 ** 53 - 11000 }],
  ])('rejects cash with %s', async (_label, amounts) => {
    await expect(
      completeOrder([croissant], { method: 'cash', ...amounts }, database),
    ).rejects.toThrow('non-negative')
    expect(await database.orders.count()).toBe(0)
  })

  it('accepts exact cash for a ฿0 cart of free items', async () => {
    const free = { productId: 'p-water', name: 'Water', unitPrice: 0, qty: 1 }
    const o = await completeOrder([free], { method: 'cash', tendered: 0, change: 0 }, database)
    expect(o.total).toBe(0)
  })

  it('rejects a PromptPay order for ฿0', async () => {
    const free = { productId: 'p-water', name: 'Water', unitPrice: 0, qty: 1 }
    await expect(
      completeOrder(
        [free],
        { method: 'promptpay', confirmedAt: new Date().toISOString() },
        database,
      ),
    ).rejects.toThrow('฿0')
    expect(await database.orders.count()).toBe(0)
  })

  it.each([
    ['a fractional price', [{ ...croissant, unitPrice: 55.5 }]],
    ['a zero qty', [{ ...croissant, qty: 0 }]],
    ['a duplicate productId', [croissant, { ...croissant }]],
    [
      'a total that overflows',
      [
        { productId: 'p-a', name: 'A', unitPrice: Number.MAX_SAFE_INTEGER, qty: 1 },
        { productId: 'p-b', name: 'B', unitPrice: 1, qty: 1 },
      ],
    ],
  ])('rejects lines with %s and stores nothing', async (_label, lines) => {
    await expect(
      completeOrder(
        lines,
        { method: 'promptpay', confirmedAt: new Date().toISOString() },
        database,
      ),
    ).rejects.toThrow('invalid lines')
    expect(await database.orders.count()).toBe(0)
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
    const seedProduct = seedProducts.find((p) => p.id === 'p-brownie-9')!
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

  it('repricing a product after completeOrder does not change the stored order', async () => {
    const seedProduct = seedProducts.find((p) => p.id === 'p-brownie-9')!
    await database.products.add(seedProduct)
    const originalPrice = seedProduct.price

    const lines = addProduct([], seedProduct)
    const order = await completeOrder(
      lines,
      { method: 'cash', tendered: cartTotal(lines), change: 0 },
      database,
    )

    await database.products.update(seedProduct.id, { price: originalPrice + 10000 })

    const stored = await database.orders.get(order.id)
    expect(stored?.lines[0].unitPrice).toBe(originalPrice)
    expect(stored?.total).toBe(originalPrice)
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

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: `o-${Math.random()}`,
    number: 1,
    lines: [croissant],
    total: 11000,
    payment: { method: 'cash', tendered: 11000, change: 0 },
    status: 'completed',
    createdAt: new Date().toISOString(),
    sync: 'pending',
    ...overrides,
  }
}

/**
 * Re-expresses `d` as an ISO-8601-*ish* string with an explicit `offsetHours`
 * numeric offset instead of a trailing `Z`, denoting the exact same instant
 * as `d` — standard ISO 8601 offset semantics are `wall_clock = UTC + offset`,
 * so the wall-clock fields printed here are `d`'s UTC fields shifted by
 * `offsetHours`. Used only to construct test data `completeOrder` itself
 * would never produce (it always writes `Z`), for `todaysOrders`'s
 * documented blind spot around non-`Z` timestamps.
 */
function isoWithOffset(d: Date, offsetHours: number): string {
  const shifted = new Date(d.getTime() + offsetHours * 3600_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const sign = offsetHours >= 0 ? '+' : '-'
  const datePart = `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
  const timePart = `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}.${String(shifted.getUTCMilliseconds()).padStart(3, '0')}`
  return `${datePart}T${timePart}${sign}${pad(Math.abs(offsetHours))}:00`
}

describe('todaysOrders', () => {
  // Jan 15, 2026, 10:00 local — the reference "now" most tests pass in.
  const now = new Date(2026, 0, 15, 10, 0)

  it("returns only orders within today's local range, newest first", async () => {
    const startOfDay = new Date(2026, 0, 15, 0, 0, 0, 0)
    const midDay = new Date(2026, 0, 15, 12, 0)
    const justBeforeMidnight = new Date(new Date(2026, 0, 16, 0, 0, 0, 0).getTime() - 1)
    const yesterday = new Date(2026, 0, 14, 23, 59)
    const tomorrow = new Date(2026, 0, 16, 0, 0, 0, 0)

    const orders = [
      makeOrder({ id: 'o-morning', number: 1, createdAt: startOfDay.toISOString() }),
      makeOrder({ id: 'o-mid', number: 2, createdAt: midDay.toISOString() }),
      makeOrder({ id: 'o-late', number: 3, createdAt: justBeforeMidnight.toISOString() }),
      makeOrder({ id: 'o-yesterday', number: 4, createdAt: yesterday.toISOString() }),
      makeOrder({ id: 'o-tomorrow', number: 5, createdAt: tomorrow.toISOString() }),
    ]
    await database.orders.bulkAdd(orders)

    const result = await todaysOrders(database, now)
    expect(result.map((o) => o.id)).toEqual(['o-late', 'o-mid', 'o-morning'])
  })

  it('breaks a createdAt tie by number, highest (newest) first', async () => {
    const sameInstant = new Date(2026, 0, 15, 12, 0).toISOString()
    await database.orders.bulkAdd([
      makeOrder({ id: 'o-a', number: 1, createdAt: sameInstant }),
      makeOrder({ id: 'o-b', number: 2, createdAt: sameInstant }),
    ])

    const result = await todaysOrders(database, now)
    expect(result.map((o) => o.id)).toEqual(['o-b', 'o-a'])
  })

  it('an order with a missing createdAt neither appears nor throws', async () => {
    const bad = makeOrder({ id: 'o-bad', number: 1 }) as Partial<Order>
    delete bad.createdAt
    const good = makeOrder({ id: 'o-good', number: 2, createdAt: now.toISOString() })
    await database.orders.bulkAdd([bad as Order, good])

    const result = await todaysOrders(database, now)
    expect(result.map((o) => o.id)).toEqual(['o-good'])
  })

  it('an order with a non-string createdAt neither appears nor throws', async () => {
    const bad = makeOrder({ id: 'o-bad', number: 1 })
    // @ts-expect-error deliberately corrupt createdAt for the test
    bad.createdAt = 1234567890
    await database.orders.bulkAdd([bad])

    await expect(todaysOrders(database, now)).resolves.toEqual([])
  })

  it('documented limitation: an order whose createdAt uses a non-Z numeric offset is invisible, even for the same instant as one that would be included', async () => {
    // `now` itself, Z-normalized, is already proven (elsewhere in this
    // describe block) to fall inside today's range — it's what every other
    // "inside today" test in this file anchors to.
    const zForm = now.toISOString()
    await database.orders.add(makeOrder({ id: 'o-z', number: 1, createdAt: zForm }))

    // The exact same instant, re-expressed with an explicit -12:00 offset
    // instead of Z — still a perfectly parseable ISO instant (`isValidOrder`
    // would accept it) representing the identical moment, but no longer
    // sorting as a *string* inside [startISO, endISO), which are both
    // Z-normalized. This isn't rejected by some validity check — the row is
    // invisible to the indexed range scan itself, so `todaysOrders` never
    // sees it at all, and there's nothing to log.
    const offsetForm = isoWithOffset(now, -12)
    await database.orders.add(makeOrder({ id: 'o-offset', number: 2, createdAt: offsetForm }))

    const result = await todaysOrders(database, now)
    expect(result.map((o) => o.id)).toEqual(['o-z'])
  })

  it('includes voided orders (todaysOrders is not filtered by status)', async () => {
    const voided = makeOrder({
      id: 'o-voided',
      number: 1,
      status: 'voided',
      voidedAt: now.toISOString(),
      voidReason: 'test',
      createdAt: now.toISOString(),
    })
    await database.orders.add(voided)

    const result = await todaysOrders(database, now)
    expect(result.map((o) => o.id)).toEqual(['o-voided'])
  })

  it('defaults `now` to the current time', async () => {
    const order = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 11000, change: 0 },
      database,
    )

    const result = await todaysOrders(database)
    expect(result.map((o) => o.id)).toContain(order.id)
  })
})

describe('ordersForDay', () => {
  it('returns the orders of any given local day, not just today', async () => {
    const jan14 = new Date(2026, 0, 14, 16, 0)
    const jan15 = new Date(2026, 0, 15, 9, 0)
    await database.orders.bulkAdd([
      makeOrder({ id: 'o-14', number: 1, createdAt: jan14.toISOString() }),
      makeOrder({ id: 'o-15', number: 2, createdAt: jan15.toISOString() }),
    ])

    expect((await ordersForDay(database, jan14)).map((o) => o.id)).toEqual(['o-14'])
    expect((await ordersForDay(database, jan15)).map((o) => o.id)).toEqual(['o-15'])
  })

  it('uses the local day of the given instant, whatever the time of day', async () => {
    const dayStart = new Date(2026, 0, 15, 0, 0, 0, 0)
    const dayEnd = new Date(new Date(2026, 0, 16, 0, 0, 0, 0).getTime() - 1)
    await database.orders.bulkAdd([
      makeOrder({ id: 'o-first', number: 1, createdAt: dayStart.toISOString() }),
      makeOrder({ id: 'o-last', number: 2, createdAt: dayEnd.toISOString() }),
    ])

    // Both instants below are the same local day, so both pick both orders.
    expect((await ordersForDay(database, dayStart)).map((o) => o.id)).toEqual(['o-last', 'o-first'])
    expect((await ordersForDay(database, dayEnd)).map((o) => o.id)).toEqual(['o-last', 'o-first'])
  })

  it('returns an empty list for a day with no orders, rather than throwing', async () => {
    await database.orders.add(
      makeOrder({ id: 'o-15', number: 1, createdAt: new Date(2026, 0, 15, 9, 0).toISOString() }),
    )

    await expect(ordersForDay(database, new Date(2026, 0, 16, 9, 0))).resolves.toEqual([])
  })

  it('sorts newest-first and breaks a createdAt tie by number, like todaysOrders', async () => {
    const sameInstant = new Date(2026, 0, 15, 12, 0).toISOString()
    const earlier = new Date(2026, 0, 15, 8, 0).toISOString()
    await database.orders.bulkAdd([
      makeOrder({ id: 'o-a', number: 1, createdAt: sameInstant }),
      makeOrder({ id: 'o-b', number: 2, createdAt: sameInstant }),
      makeOrder({ id: 'o-early', number: 3, createdAt: earlier }),
    ])

    const result = await ordersForDay(database, new Date(2026, 0, 15, 20, 0))
    expect(result.map((o) => o.id)).toEqual(['o-b', 'o-a', 'o-early'])
  })

  it('defaults `day` to today', async () => {
    const order = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 11000, change: 0 },
      database,
    )

    expect((await ordersForDay(database)).map((o) => o.id)).toContain(order.id)
  })

  it('is what todaysOrders delegates to: both agree for the same instant', async () => {
    const now = new Date(2026, 0, 15, 10, 0)
    await database.orders.bulkAdd([
      makeOrder({ id: 'o-1', number: 1, createdAt: new Date(2026, 0, 15, 8, 0).toISOString() }),
      makeOrder({ id: 'o-2', number: 2, createdAt: new Date(2026, 0, 15, 9, 0).toISOString() }),
      makeOrder({ id: 'o-old', number: 3, createdAt: new Date(2026, 0, 14, 9, 0).toISOString() }),
    ])

    expect(await todaysOrders(database, now)).toEqual(await ordersForDay(database, now))
  })
})
