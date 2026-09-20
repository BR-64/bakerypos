import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildExport, parseImport, type BackupPayload } from '../domain/backup'
import { DEFAULT_SETTINGS, SETTINGS_ID, type Settings } from '../domain/settings'
import type { Order, Product } from '../domain/types'
import { importBackup, previewImport } from './backup'
import { PosDatabase } from './db'
import { getSettings, saveSettings } from './settings'

let source: PosDatabase
let target: PosDatabase

beforeEach(async () => {
  source = new PosDatabase(`test-${Math.random()}`)
  target = new PosDatabase(`test-${Math.random()}`)
  await source.open()
  await target.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'pastry',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

const sourdough: Product = {
  id: 'p-sourdough',
  name: 'Sourdough',
  price: 12000,
  category: 'bread',
  sortOrder: 2,
  outOfStock: true,
  archived: true,
}

function at(hour: number, minute = 0): string {
  const when = new Date(2026, 8, 20)
  when.setHours(hour, minute, 0, 0)
  return when.toISOString()
}

const cashOrder: Order = {
  id: 'o-1',
  number: 1,
  lines: [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }],
  total: 11000,
  payment: { method: 'cash', tendered: 20000, change: 9000 },
  status: 'completed',
  createdAt: at(9, 5),
  sync: 'pending',
}

const voidedOrder: Order = {
  id: 'o-2',
  number: 2,
  lines: [{ productId: 'p-sourdough', name: 'Sourdough', unitPrice: 12000, qty: 1 }],
  total: 12000,
  payment: { method: 'promptpay', confirmedAt: at(10, 0) },
  status: 'voided',
  voidedAt: at(10, 30),
  voidReason: 'Wrong item',
  createdAt: at(10, 0),
  sync: 'synced',
}

const shopSettings: Settings = {
  ...DEFAULT_SETTINGS,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
}

/** Fill `source` with a shop, then produce the file the Export button would. */
async function exportFromSource(): Promise<BackupPayload> {
  const [products, orders, settings] = await Promise.all([
    source.products.toArray(),
    source.orders.toArray(),
    getSettings(source),
  ])
  return buildExport({ products, orders, settings })
}

async function seedSource(): Promise<void> {
  await source.products.bulkAdd([croissant, sourdough])
  await source.orders.bulkAdd([cashOrder, voidedOrder])
  await saveSettings(shopSettings, source)
}

/** A PIN already set on the target device — nothing an import does may move it. */
const pin = { pinHash: 'a'.repeat(64), pinSalt: 'c'.repeat(32), recoveryHash: 'b'.repeat(64) }

describe('export → import on an empty database', () => {
  it('reproduces every product and order exactly', async () => {
    await seedSource()
    const payload = exportedThroughAFile(await exportFromSource())

    const summary = await importBackup(payload, target)

    expect(summary).toEqual({
      products: 2,
      orders: 2,
      newProducts: 2,
      existingProducts: 0,
      newOrders: 2,
      existingOrders: 0,
      settingsChanged: true,
    })
    await expect(target.products.orderBy('id').toArray()).resolves.toEqual(
      await source.products.orderBy('id').toArray(),
    )
    await expect(target.orders.orderBy('id').toArray()).resolves.toEqual(
      await source.orders.orderBy('id').toArray(),
    )
    const settings = await getSettings(target)
    expect(settings.shopName).toBe('Sunrise Bakery')
    expect(settings.promptPayId).toBe('0812345678')
  })

  it('adds nothing the second time the same file is imported', async () => {
    await seedSource()
    const payload = exportedThroughAFile(await exportFromSource())

    await importBackup(payload, target)
    const second = await importBackup(payload, target)

    expect(second).toMatchObject({ newOrders: 0, existingOrders: 2, newProducts: 0 })
    await expect(target.orders.count()).resolves.toBe(2)
    await expect(target.products.count()).resolves.toBe(2)
  })
})

/** Round-trip a payload through the actual file text, as the screen does. */
function exportedThroughAFile(payload: BackupPayload): BackupPayload {
  const result = parseImport(JSON.stringify(payload, null, 2))
  if (!result.ok) throw new Error(result.error)
  return result.payload
}

describe('importBackup — the orders table', () => {
  it('never overwrites an order the device already has', async () => {
    await seedSource()
    const payload = await exportFromSource()
    // The device's copy has since been voided — the backup predates that.
    const voidedHere: Order = {
      ...cashOrder,
      status: 'voided',
      voidedAt: at(11, 0),
      voidReason: 'Customer changed their mind',
      sync: 'synced',
    }
    await target.orders.add(voidedHere)

    const summary = await importBackup(payload, target)

    expect(summary).toMatchObject({ newOrders: 1, existingOrders: 1 })
    await expect(target.orders.get('o-1')).resolves.toEqual(voidedHere)
  })

  it('keeps orders the file has never heard of', async () => {
    await seedSource()
    const payload = await exportFromSource()
    const local: Order = { ...cashOrder, id: 'o-local', number: 99, createdAt: at(15, 0) }
    await target.orders.add(local)

    await importBackup(payload, target)

    await expect(target.orders.get('o-local')).resolves.toEqual(local)
    await expect(target.orders.count()).resolves.toBe(3)
  })
})

describe('importBackup — the products table', () => {
  it('updates a product in place and keeps local-only ones', async () => {
    await seedSource()
    const payload = await exportFromSource()
    await target.products.bulkAdd([
      { ...croissant, name: 'Old name', price: 100 },
      { ...croissant, id: 'p-local', name: 'Local only' },
    ])

    const summary = await importBackup(payload, target)

    expect(summary).toMatchObject({ newProducts: 1, existingProducts: 1 })
    await expect(target.products.get('p-croissant')).resolves.toEqual(croissant)
    await expect(target.products.get('p-local')).resolves.toMatchObject({ name: 'Local only' })
  })

  it('does not rewrite the price an old order was sold at', async () => {
    await seedSource()
    await source.products.update('p-croissant', { price: 9900 })
    const payload = await exportFromSource()
    await target.orders.add(cashOrder)

    await importBackup(payload, target)

    // The product's price moved; the order's snapshot did not.
    await expect(target.products.get('p-croissant')).resolves.toMatchObject({ price: 9900 })
    const stored = await target.orders.get('o-1')
    expect(stored?.lines[0].unitPrice).toBe(5500)
    expect(stored?.total).toBe(11000)
  })
})

describe('importBackup — the PIN', () => {
  it('leaves the PIN fields exactly as they are on this device', async () => {
    await seedSource()
    await saveSettings({ ...DEFAULT_SETTINGS, ...pin, lockedUntil: 1_800_000_000_000 }, target)
    const payload = await exportFromSource()

    await importBackup(payload, target)

    const stored = await target.settings.get(SETTINGS_ID)
    expect(stored).toMatchObject(pin)
    expect(stored?.lockedUntil).toBe(1_800_000_000_000)
    // …while the shop fields did come across.
    expect(stored?.shopName).toBe('Sunrise Bakery')
  })

  it('ignores PIN fields smuggled into a hand-edited payload', async () => {
    await seedSource()
    await saveSettings({ ...DEFAULT_SETTINGS, ...pin }, target)
    const payload = await exportFromSource()
    const smuggled = {
      ...payload,
      settings: {
        ...payload.settings,
        pinHash: 'd'.repeat(64),
        pinSalt: 'e'.repeat(32),
        recoveryHash: 'f'.repeat(64),
        lockedUntil: 4_000_000_000_000,
      },
    } as BackupPayload

    await importBackup(smuggled, target)

    const stored = await target.settings.get(SETTINGS_ID)
    expect(stored).toMatchObject(pin)
    expect(stored?.lockedUntil).toBeNull()
  })
})

describe('importBackup — a corrupt file', () => {
  async function snapshot(database: PosDatabase) {
    return {
      products: await database.products.orderBy('id').toArray(),
      orders: await database.orders.orderBy('id').toArray(),
      settings: await database.settings.get(SETTINGS_ID),
    }
  }

  it('is rejected whole, with no partial write', async () => {
    await seedSource()
    await target.products.add({ ...croissant, name: 'Untouched' })
    await saveSettings({ ...DEFAULT_SETTINGS, ...pin, shopName: 'Before' }, target)
    const payload = await exportFromSource()
    const corrupt = {
      ...payload,
      // One order's stored total no longer matches its lines — the file
      // cannot be vouched for, so none of it lands.
      orders: [payload.orders[0], { ...payload.orders[1], total: 1 }],
    } as BackupPayload
    const before = await snapshot(target)

    await expect(importBackup(corrupt, target)).rejects.toThrow(/Order 2/)

    // Not one product, not one order, not the shop name: nothing moved.
    await expect(snapshot(target)).resolves.toEqual(before)
  })

  it('refuses a payload that is not a backup at all', async () => {
    await expect(importBackup({} as BackupPayload, target)).rejects.toThrow(/not a Bakery POS/)
    await expect(target.orders.count()).resolves.toBe(0)
  })

  it('imports nothing when the settings row cannot be read', async () => {
    await seedSource()
    const payload = await exportFromSource()
    vi.spyOn(target.settings, 'get').mockRejectedValue(new Error('IndexedDB is having a day'))

    await expect(importBackup(payload, target)).rejects.toThrow()

    // The orders were written inside the same transaction, so the failed
    // settings read rolled them back with it.
    await expect(target.orders.count()).resolves.toBe(0)
    await expect(target.products.count()).resolves.toBe(0)
  })
})

describe('previewImport', () => {
  it('counts what the merge would do, and writes nothing', async () => {
    await seedSource()
    const payload = await exportFromSource()
    await target.orders.add(cashOrder)
    await target.products.add(croissant)

    const summary = await previewImport(payload, target)

    expect(summary).toEqual({
      products: 2,
      orders: 2,
      newProducts: 1,
      existingProducts: 1,
      newOrders: 1,
      existingOrders: 1,
      settingsChanged: true,
    })
    await expect(target.orders.count()).resolves.toBe(1)
    await expect(target.products.count()).resolves.toBe(1)
    await expect(target.settings.get(SETTINGS_ID)).resolves.toBeUndefined()
  })

  it('says so when the shop settings are already the ones in the file', async () => {
    await seedSource()
    const payload = await exportFromSource()
    await saveSettings({ ...shopSettings, ...pin }, target)

    await expect(previewImport(payload, target)).resolves.toMatchObject({ settingsChanged: false })
  })

  it('refuses a corrupt payload without reading the tables', async () => {
    await expect(
      previewImport({ format: 'something-else' } as unknown as BackupPayload, target),
    ).rejects.toThrow(/not a Bakery POS/)
  })
})
