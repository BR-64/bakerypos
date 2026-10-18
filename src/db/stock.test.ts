import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_STOCK_INPUT } from '../domain/stock'
import type { Product, StockMovement } from '../domain/types'
import { PosDatabase } from './db'
import { receiveStock, setStockCount, stockHistory } from './stock'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

const brownie: Product = {
  id: 'p-brownie',
  name: 'Brownie',
  price: 6500,
  category: 'brownies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

describe('setStockCount', () => {
  it('starts tracking an untracked product and logs a set movement', async () => {
    await database.products.add(brownie)

    const movement = await setStockCount('p-brownie', 5, database)

    expect(await database.products.get('p-brownie')).toEqual({ ...brownie, stock: 5 })
    expect(movement).toMatchObject({
      productId: 'p-brownie',
      kind: 'set',
      delta: 5,
      level: 5,
      previous: null,
    })
    expect(movement).not.toHaveProperty('orderId')
    expect(await database.stockMovements.toArray()).toEqual([movement])
  })

  it('records the change from the previous count', async () => {
    await database.products.add({ ...brownie, stock: 8 })

    const movement = await setStockCount('p-brownie', 3, database)

    expect(movement).toMatchObject({ delta: -5, level: 3, previous: 8 })
    expect((await database.products.get('p-brownie'))?.stock).toBe(3)
  })

  it('logs a delta-0 movement for a same-value stocktake', async () => {
    await database.products.add({ ...brownie, stock: 4 })

    const movement = await setStockCount('p-brownie', 4, database)

    expect(movement).toMatchObject({ delta: 0, level: 4, previous: 4 })
    expect(await database.stockMovements.count()).toBe(1)
  })

  it('repairs an unreadable count: previous null, delta = count', async () => {
    await database.products.add({ ...brownie, stock: 'abc' as unknown as number })

    const movement = await setStockCount('p-brownie', 6, database)

    expect(movement).toMatchObject({ delta: 6, level: 6, previous: null })
    expect((await database.products.get('p-brownie'))?.stock).toBe(6)
  })

  it('logs a corrupt far-out count like an unreadable one, so the delta stays safe', async () => {
    await database.products.add({ ...brownie, stock: -Number.MAX_SAFE_INTEGER })

    const movement = await setStockCount('p-brownie', 5, database)

    expect(movement).toMatchObject({ delta: 5, level: 5, previous: null })
    expect(Number.isSafeInteger(movement.delta)).toBe(true)
  })

  it('works on an archived product and leaves every other field (photo included) alone', async () => {
    const image = {
      blob: new Blob([new Uint8Array(1024)], { type: 'image/webp' }),
      type: 'image/webp',
      width: 512,
      height: 384,
    }
    await database.products.add({ ...brownie, archived: true, outOfStock: true, image })

    await setStockCount('p-brownie', 2, database)

    const stored = await database.products.get('p-brownie')
    expect(stored).toMatchObject({ archived: true, outOfStock: true, stock: 2, price: 6500 })
    expect(stored?.image?.blob.size).toBe(1024)
  })

  it('rejects a missing product and writes nothing', async () => {
    await expect(setStockCount('nope', 5, database)).rejects.toThrow('not found')
    expect(await database.stockMovements.count()).toBe(0)
  })

  it.each([-1, 1.5, NaN, MAX_STOCK_INPUT + 1])('rejects count %s', async (count) => {
    await database.products.add(brownie)
    await expect(setStockCount('p-brownie', count, database)).rejects.toThrow()
    expect(await database.products.get('p-brownie')).toEqual(brownie)
    expect(await database.stockMovements.count()).toBe(0)
  })
})

describe('receiveStock', () => {
  it('adds to a tracked count and logs a received movement', async () => {
    await database.products.add({ ...brownie, stock: -2 })

    const movement = await receiveStock('p-brownie', 12, database)

    expect(movement).toMatchObject({ kind: 'received', delta: 12, level: 10, previous: -2 })
    expect((await database.products.get('p-brownie'))?.stock).toBe(10)
    expect(await database.stockMovements.count()).toBe(1)
  })

  it('rejects an untracked product: set a count first', async () => {
    await database.products.add(brownie)

    await expect(receiveStock('p-brownie', 3, database)).rejects.toThrow('Set a count first')
    expect(await database.products.get('p-brownie')).toEqual(brownie)
    expect(await database.stockMovements.count()).toBe(0)
  })

  it('rejects an unreadable count too', async () => {
    await database.products.add({ ...brownie, stock: 1.5 })
    await expect(receiveStock('p-brownie', 3, database)).rejects.toThrow('Set a count first')
    expect(await database.stockMovements.count()).toBe(0)
  })

  it('rejects a missing product', async () => {
    await expect(receiveStock('nope', 3, database)).rejects.toThrow('not found')
  })

  it.each([0, -1, 1.5, MAX_STOCK_INPUT + 1])('rejects quantity %s', async (qty) => {
    await database.products.add({ ...brownie, stock: 1 })
    await expect(receiveStock('p-brownie', qty, database)).rejects.toThrow()
    expect((await database.products.get('p-brownie'))?.stock).toBe(1)
  })

  it('rejects a delivery that would overflow the count', async () => {
    await database.products.add({ ...brownie, stock: Number.MAX_SAFE_INTEGER })
    await expect(receiveStock('p-brownie', 1, database)).rejects.toThrow()
    expect(await database.stockMovements.count()).toBe(0)
  })

  it('a failing movement write leaves the count unchanged', async () => {
    await database.products.add({ ...brownie, stock: 4 })
    vi.spyOn(database.stockMovements, 'add').mockRejectedValueOnce(new Error('disk full'))

    await expect(receiveStock('p-brownie', 3, database)).rejects.toThrow('disk full')
    expect((await database.products.get('p-brownie'))?.stock).toBe(4)
  })
})

describe('stockHistory', () => {
  it('returns one product’s movements newest first, up to the limit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await database.products.bulkAdd([brownie, { ...brownie, id: 'p-other', name: 'Other' }])
    vi.setSystemTime(new Date(2026, 0, 15, 8, 0))
    await setStockCount('p-brownie', 5, database)
    vi.setSystemTime(new Date(2026, 0, 15, 9, 0))
    await setStockCount('p-other', 1, database)
    vi.setSystemTime(new Date(2026, 0, 15, 10, 0))
    await receiveStock('p-brownie', 3, database)
    vi.setSystemTime(new Date(2026, 0, 15, 11, 0))
    await setStockCount('p-brownie', 7, database)

    const history = await stockHistory('p-brownie', database)
    expect(history.map((m) => [m.kind, m.level])).toEqual([
      ['set', 7],
      ['received', 8],
      ['set', 5],
    ])

    const latest = await stockHistory('p-brownie', database, 2)
    expect(latest.map((m) => m.level)).toEqual([7, 8])
  })

  it('defaults to the latest 50', async () => {
    const movements: StockMovement[] = Array.from({ length: 60 }, (_, i) => ({
      id: `m-${i}`,
      productId: 'p-brownie',
      kind: 'received',
      delta: 1,
      level: i + 1,
      previous: i,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }))
    await database.stockMovements.bulkAdd(movements)

    const history = await stockHistory('p-brownie', database)
    expect(history).toHaveLength(50)
    expect(history[0].level).toBe(60)
    expect(history[49].level).toBe(11)
  })

  it('is empty for a product with no history', async () => {
    await expect(stockHistory('p-brownie', database)).resolves.toEqual([])
  })
})
