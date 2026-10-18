import Dexie from 'dexie'
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings'
import type { Order, Product } from '../domain/types'
import { PosDatabase } from './db'
import { completeOrder, ordersForDay } from './orders'
import { getSettings, saveSettings } from './settings'

/**
 * A genuine schema-v1 database: a bare `new Dexie(name)` that declares
 * *only* version 1, byte-for-byte the store definitions that shipped in
 * `PosDatabase`'s `.version(1)` block.
 *
 * `PosDatabase` itself must never be used for this — its constructor now
 * declares `.version(2)` too, so opening a fresh name with it would create
 * a v2 database directly and the "upgrade" would be a no-op that proves
 * nothing.
 */
function openV1(name: string): Dexie {
  const v1 = new Dexie(name)
  v1.version(1).stores({
    products: 'id, category, sortOrder',
    orders: 'id, number, createdAt, status, sync',
  })
  return v1
}

/** Jan 15 2026, 09:30 local — the day every order below is stored on. */
const day = new Date(2026, 0, 15, 9, 30)

const v1Products: Product[] = [
  {
    id: 'p-baguette',
    name: 'Baguette',
    price: 6000,
    category: 'brownies',
    sortOrder: 2,
    outOfStock: true,
    archived: false,
  },
  {
    id: 'p-croissant',
    name: 'Croissant',
    price: 5500,
    category: 'cookies',
    sortOrder: 1,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-old-cake',
    name: 'Discontinued Cake',
    price: 9000,
    category: 'jar',
    sortOrder: 3,
    outOfStock: false,
    archived: true,
  },
]

const v1Orders: Order[] = [
  {
    id: 'o-1',
    number: 1,
    lines: [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }],
    total: 11000,
    payment: { method: 'cash', tendered: 20000, change: 9000 },
    status: 'completed',
    createdAt: new Date(2026, 0, 15, 8, 15).toISOString(),
    sync: 'pending',
  },
  {
    id: 'o-2',
    number: 2,
    lines: [{ productId: 'p-baguette', name: 'Baguette', unitPrice: 6000, qty: 1 }],
    total: 6000,
    payment: { method: 'promptpay', confirmedAt: new Date(2026, 0, 15, 8, 45).toISOString() },
    status: 'voided',
    createdAt: new Date(2026, 0, 15, 8, 40).toISOString(),
    voidedAt: new Date(2026, 0, 15, 8, 50).toISOString(),
    voidReason: 'Wrong item',
    sync: 'synced',
  },
]

async function seedV1(name: string): Promise<void> {
  const v1 = openV1(name)
  await v1.open()
  // Proves the fixture really is a v1 database before anything is written
  // into it — otherwise the upgrade assertions below test nothing.
  expect(v1.verno).toBe(1)
  await v1.table('products').bulkAdd(v1Products)
  await v1.table('orders').bulkAdd(v1Orders)
  // Closed before the upgrade, the way an app that has finished with a
  // connection should. Not strictly required — IndexedDB asks a blocking
  // connection to stand down via `versionchange`, and Dexie closes itself
  // when it gets that (proven by the last test in this file) — but an
  // explicit close keeps these tests testing the migration rather than
  // the blocking protocol.
  v1.close()
}

describe('PosDatabase schema v1 -> current', () => {
  it('upgrades an existing v1 database to the current version and adds the settings store', async () => {
    const name = `test-${Math.random()}`
    await seedV1(name)

    const database = new PosDatabase(name)
    await database.open()

    expect(database.verno).toBe(3)
    expect(database.tables.map((t) => t.name).sort()).toEqual([
      'orders',
      'products',
      'settings',
      'stockMovements',
    ])
    database.close()
  })

  it('keeps every product and order exactly as stored, including voidedAt/voidReason', async () => {
    const name = `test-${Math.random()}`
    await seedV1(name)

    const database = new PosDatabase(name)
    await database.open()

    // toEqual on the whole records, not a count: a migration that silently
    // rewrote or dropped a field would still count correctly.
    expect(await database.products.orderBy('id').toArray()).toEqual(v1Products)
    expect(await database.orders.orderBy('id').toArray()).toEqual(v1Orders)

    const voided = await database.orders.get('o-2')
    expect(voided?.voidedAt).toBe(v1Orders[1].voidedAt)
    expect(voided?.voidReason).toBe('Wrong item')
    database.close()
  })

  it('keeps the createdAt index working, so the day query still finds the v1 orders', async () => {
    const name = `test-${Math.random()}`
    await seedV1(name)

    const database = new PosDatabase(name)
    await database.open()

    // An indexed range read — it returns nothing at all if the upgrade
    // dropped the `createdAt` index.
    const result = await ordersForDay(database, day)
    expect(result.map((o) => o.id)).toEqual(['o-2', 'o-1'])
    database.close()
  })

  it('continues the running order number from the v1 orders', async () => {
    const name = `test-${Math.random()}`
    await seedV1(name)

    const database = new PosDatabase(name)
    await database.open()

    const order = await completeOrder(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      { method: 'cash', tendered: 5500, change: 0 },
      database,
    )
    // The `number` index survived, so the next order is 3 — not 1, which is
    // what a lost index or a dropped store would produce.
    expect(order.number).toBe(3)
    expect(await database.orders.count()).toBe(3)
    database.close()
  })

  it('makes the new settings store usable on the upgraded database', async () => {
    const name = `test-${Math.random()}`
    await seedV1(name)

    const database = new PosDatabase(name)
    await database.open()

    // No row is created by the upgrade itself, so an upgraded device reads
    // the defaults until its first Admin save.
    expect(await database.settings.count()).toBe(0)
    await expect(getSettings(database)).resolves.toEqual(DEFAULT_SETTINGS)

    const saved: Settings = {
      ...DEFAULT_SETTINGS,
      shopName: 'Sunrise Bakery',
      promptPayId: '0812345678',
    }
    await saveSettings(saved, database)
    await expect(getSettings(database)).resolves.toEqual(saved)
    database.close()
  })
})

describe('PosDatabase upgrading around a still-open v1 connection', () => {
  it('does not hang: the blocking v1 connection is auto-closed on versionchange', async () => {
    const name = `test-${Math.random()}`
    const v1 = openV1(name)
    await v1.open()
    expect(v1.verno).toBe(1)
    await v1.table('orders').bulkAdd(v1Orders)
    // Deliberately NOT closed — this is the real-world case of a second
    // tab, or a reload racing its predecessor's teardown.

    const database = new PosDatabase(name)
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('v2 open was blocked by the v1 connection')), 5000)
    })
    try {
      // A race, not a bare await: a genuinely blocked upgrade would
      // otherwise sit here until the whole test file timed out, with
      // nothing to say why.
      await Promise.race([database.open(), timeout])
    } finally {
      clearTimeout(timer)
    }

    expect(database.verno).toBe(3)
    expect(await database.orders.count()).toBe(v1Orders.length)
    v1.close()
    database.close()
  })
})

/**
 * A genuine schema-v2 database: a bare `Dexie` declaring exactly the v1 and
 * v2 blocks that shipped, so reopening it with `PosDatabase` really runs
 * the v2 → v3 upgrade (task 8d) rather than creating v3 from scratch.
 */
function openV2(name: string): Dexie {
  const v2 = new Dexie(name)
  v2.version(1).stores({
    products: 'id, category, sortOrder',
    orders: 'id, number, createdAt, status, sync',
  })
  v2.version(2).stores({
    settings: 'id',
  })
  return v2
}

const v2Settings: Settings = {
  ...DEFAULT_SETTINGS,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
}

describe('PosDatabase schema v2 -> v3 (stock movements)', () => {
  async function seedV2(name: string): Promise<void> {
    const v2 = openV2(name)
    await v2.open()
    expect(v2.verno).toBe(2)
    await v2.table('products').bulkAdd(v1Products)
    await v2.table('orders').bulkAdd(v1Orders)
    await v2.table('settings').add(v2Settings)
    v2.close()
  }

  it('upgrades to v3 with every row unchanged and every product untracked', async () => {
    const name = `test-${Math.random()}`
    await seedV2(name)

    const database = new PosDatabase(name)
    await database.open()

    expect(database.verno).toBe(3)
    expect(await database.products.orderBy('id').toArray()).toEqual(v1Products)
    expect(await database.orders.orderBy('id').toArray()).toEqual(v1Orders)
    expect(await database.settings.toArray()).toEqual([v2Settings])
    for (const product of await database.products.toArray()) {
      expect(product).not.toHaveProperty('stock')
    }
    database.close()
  })

  it('keeps the v1 indexes working and makes stockMovements usable', async () => {
    const name = `test-${Math.random()}`
    await seedV2(name)

    const database = new PosDatabase(name)
    await database.open()

    expect((await ordersForDay(database, day)).map((o) => o.id)).toEqual(['o-2', 'o-1'])
    expect(await database.stockMovements.count()).toBe(0)
    await database.stockMovements.add({
      id: 'm-1',
      productId: 'p-croissant',
      kind: 'set',
      delta: 5,
      level: 5,
      previous: null,
      createdAt: new Date(2026, 0, 15, 9, 0).toISOString(),
    })
    expect(await database.stockMovements.where('orderId').equals('o-1').count()).toBe(0)
    expect(
      await database.stockMovements
        .where('[productId+createdAt]')
        .between(['p-croissant', Dexie.minKey], ['p-croissant', Dexie.maxKey])
        .count(),
    ).toBe(1)
    database.close()
  })
})

describe('PosDatabase on a fresh device', () => {
  it('opens straight at version 3 with all four stores', async () => {
    const database = new PosDatabase(`test-${Math.random()}`)
    await database.open()

    expect(database.verno).toBe(3)
    expect(database.tables.map((t) => t.name).sort()).toEqual([
      'orders',
      'products',
      'settings',
      'stockMovements',
    ])
    database.close()
  })
})
