import { beforeEach, describe, expect, it } from 'vitest'
import type { Product, ProductImage } from '../domain/types'
import { PosDatabase } from './db'
import { completeOrder } from './orders'
import {
  allProducts,
  archiveProduct,
  clearProductImage,
  createProduct,
  sellableProducts,
  setProductImage,
  setProductOutOfStock,
  updateProduct,
} from './products'

let database: PosDatabase

beforeEach(async () => {
  // Fresh DB per test; fake-indexeddb is loaded in src/test/setup.ts
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

// Shuffled sortOrder on purpose, to prove the query sorts rather than
// relying on insertion order. Includes one archived and one out-of-stock
// product. Never mutate the shared seedProducts fixture — build our own.
const fixtures: Product[] = [
  {
    id: 'p-cookie',
    name: 'Cookie',
    price: 4000,
    category: 'cookies',
    sortOrder: 3,
    outOfStock: false,
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
    price: 7500,
    category: 'jar',
    sortOrder: 2,
    outOfStock: false,
    archived: true,
  },
  {
    id: 'p-sourdough',
    name: 'Sourdough Loaf',
    price: 12000,
    category: 'brownies',
    sortOrder: 4,
    outOfStock: true,
    archived: false,
  },
]

describe('sellableProducts', () => {
  it('sorts by sortOrder, filters out archived, and keeps out-of-stock', async () => {
    await database.products.bulkAdd(fixtures)

    const result = await sellableProducts(database)

    expect(result.map((p) => p.id)).toEqual(['p-croissant', 'p-cookie', 'p-sourdough'])
    expect(result.find((p) => p.id === 'p-sourdough')?.outOfStock).toBe(true)
    expect(result.some((p) => p.id === 'p-old-cake')).toBe(false)
  })

  it('returns an empty array for an empty table', async () => {
    expect(await sellableProducts(database)).toEqual([])
  })

  it('does not silently drop a product with a missing/non-numeric sortOrder — it sorts last instead', async () => {
    const badSortOrder = {
      id: 'p-bad-sort',
      name: 'Mystery Muffin',
      price: 3000,
      category: 'cookies',
      outOfStock: false,
      archived: false,
      // sortOrder intentionally omitted — simulates a corrupted record.
    } as unknown as Product
    await database.products.bulkAdd([...fixtures, badSortOrder])

    const result = await sellableProducts(database)

    expect(result.map((p) => p.id)).toContain('p-bad-sort')
    expect(result.at(-1)?.id).toBe('p-bad-sort')
  })

  it('treats archived strictly (=== true): a non-boolean archived value is kept, not silently filtered', async () => {
    const stringArchived = {
      id: 'p-string-archived',
      name: 'Odd Item',
      price: 1000,
      category: 'cookies',
      sortOrder: 99,
      outOfStock: false,
      archived: 'false',
    } as unknown as Product
    await database.products.add(stringArchived)

    const result = await sellableProducts(database)

    expect(result.some((p) => p.id === 'p-string-archived')).toBe(true)
  })
})

describe('allProducts', () => {
  it('includes archived products, still sorted by sortOrder', async () => {
    await database.products.bulkAdd(fixtures)

    const result = await allProducts(database)

    expect(result.map((p) => p.id)).toEqual([
      'p-croissant',
      'p-old-cake',
      'p-cookie',
      'p-sourdough',
    ])
  })

  it('returns an empty array for an empty table', async () => {
    expect(await allProducts(database)).toEqual([])
  })
})

describe('createProduct', () => {
  it('adds a sellable product at the end of the grid', async () => {
    await database.products.bulkAdd(fixtures)

    const created = await createProduct(
      { name: '  Almond Croissant  ', price: 6500, category: 'cookies' },
      database,
    )

    expect(created).toMatchObject({
      name: 'Almond Croissant',
      price: 6500,
      category: 'cookies',
      sortOrder: 5,
      outOfStock: false,
      archived: false,
    })
    expect(created.id).toMatch(/[0-9a-f-]{36}/)
    expect((await sellableProducts(database)).at(-1)?.id).toBe(created.id)
  })

  it('gives each product its own sortOrder, even with a corrupt one in the table', async () => {
    await database.products.add({
      id: 'p-bad',
      name: 'Bad',
      price: 100,
      category: 'other',
      outOfStock: false,
      archived: false,
    } as unknown as Product)

    const first = await createProduct({ name: 'A', price: 100, category: 'brownies' }, database)
    const second = await createProduct({ name: 'B', price: 100, category: 'brownies' }, database)

    expect(second.sortOrder).toBeGreaterThan(first.sortOrder)
  })

  it('rejects values that could never be a valid product, writing nothing', async () => {
    await expect(
      createProduct({ name: '  ', price: 100, category: 'brownies' }, database),
    ).rejects.toThrow()
    await expect(
      createProduct({ name: 'A', price: 10.5, category: 'brownies' }, database),
    ).rejects.toThrow()
    await expect(
      createProduct({ name: 'A', price: -1, category: 'brownies' }, database),
    ).rejects.toThrow()
    await expect(
      createProduct({ name: 'A', price: 1e18, category: 'brownies' }, database),
    ).rejects.toThrow()
    await expect(
      // @ts-expect-error deliberately bad category
      createProduct({ name: 'A', price: 100, category: 'sandwiches' }, database),
    ).rejects.toThrow()
    expect(await database.products.count()).toBe(0)
  })
})

describe('updateProduct', () => {
  it('changes name, price and category, keeping sortOrder and stock state', async () => {
    await database.products.bulkAdd(fixtures)

    await updateProduct(
      'p-sourdough',
      { name: 'Rye Loaf', price: 13000, category: 'brownies' },
      database,
    )

    expect(await database.products.get('p-sourdough')).toEqual({
      id: 'p-sourdough',
      name: 'Rye Loaf',
      price: 13000,
      category: 'brownies',
      sortOrder: 4,
      outOfStock: true,
      archived: false,
    })
  })

  it('never rewrites history: an order placed before the edit keeps its snapshot price', async () => {
    await database.products.bulkAdd(fixtures)
    const order = await completeOrder(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }],
      { method: 'cash', tendered: 20000, change: 9000 },
      database,
    )

    await updateProduct(
      'p-croissant',
      { name: 'Butter Croissant', price: 9900, category: 'cookies' },
      database,
    )

    expect(await database.orders.get(order.id)).toEqual(order)
    expect((await database.orders.get(order.id))?.lines[0]).toEqual({
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 2,
    })
    expect((await database.orders.get(order.id))?.total).toBe(11000)
  })

  it('rejects an unknown id and bad values', async () => {
    await database.products.bulkAdd(fixtures)

    await expect(
      updateProduct('p-nope', { name: 'X', price: 100, category: 'brownies' }, database),
    ).rejects.toThrow('no longer exists')
    await expect(
      updateProduct('p-cookie', { name: 'X', price: 1.5, category: 'brownies' }, database),
    ).rejects.toThrow()
    expect((await database.products.get('p-cookie'))?.price).toBe(4000)
  })
})

describe('setProductOutOfStock', () => {
  it('toggles the flag without touching anything else', async () => {
    await database.products.bulkAdd(fixtures)

    await setProductOutOfStock('p-cookie', true, database)
    expect((await database.products.get('p-cookie'))?.outOfStock).toBe(true)

    await setProductOutOfStock('p-cookie', false, database)
    expect(await database.products.get('p-cookie')).toEqual(fixtures[0])
  })

  it('rejects an unknown id', async () => {
    await expect(setProductOutOfStock('p-nope', true, database)).rejects.toThrow('no longer exists')
  })
})

describe('archiveProduct', () => {
  it('archives rather than deleting: the row stays for old orders', async () => {
    await database.products.bulkAdd(fixtures)

    await archiveProduct('p-cookie', true, database)

    expect(await database.products.count()).toBe(fixtures.length)
    expect((await database.products.get('p-cookie'))?.archived).toBe(true)
    expect((await sellableProducts(database)).some((p) => p.id === 'p-cookie')).toBe(false)
    expect((await allProducts(database)).some((p) => p.id === 'p-cookie')).toBe(true)
  })

  it('can put an archived product back on the menu', async () => {
    await database.products.bulkAdd(fixtures)

    await archiveProduct('p-old-cake', false, database)

    expect((await sellableProducts(database)).some((p) => p.id === 'p-old-cake')).toBe(true)
  })

  it('rejects an unknown id', async () => {
    await expect(archiveProduct('p-nope', true, database)).rejects.toThrow('no longer exists')
  })
})

describe('setProductImage / clearProductImage', () => {
  function picture(bytes = 2048, type = 'image/webp'): ProductImage {
    const blob = new Blob([new Uint8Array(bytes)], { type })
    return { blob, type, width: 512, height: 384 }
  }

  it('stores a picture without touching name, price, position or stock', async () => {
    await database.products.bulkAdd(fixtures)

    await setProductImage('p-sourdough', picture(), database)

    const stored = await database.products.get('p-sourdough')
    expect(stored?.name).toBe('Sourdough Loaf')
    expect(stored?.price).toBe(12000)
    expect(stored?.sortOrder).toBe(4)
    expect(stored?.outOfStock).toBe(true)
    expect(stored?.image?.width).toBe(512)
    expect(stored?.image?.height).toBe(384)
    expect(stored?.image?.type).toBe('image/webp')
    expect(stored?.image?.blob.size).toBe(2048)
  })

  it('replaces a picture rather than keeping both', async () => {
    await database.products.bulkAdd(fixtures)

    await setProductImage('p-cookie', picture(2048), database)
    await setProductImage('p-cookie', picture(4096), database)

    expect((await database.products.get('p-cookie'))?.image?.blob.size).toBe(4096)
  })

  it('refuses a picture the Sell grid would then ignore, writing nothing', async () => {
    await database.products.bulkAdd(fixtures)

    // A raw 3 MB camera file is exactly what must never reach IndexedDB.
    const huge = picture(1, 'image/jpeg')
    Object.defineProperty(huge.blob, 'size', { value: 3 * 1024 * 1024 })
    await expect(setProductImage('p-cookie', huge, database)).rejects.toThrow(/larger than/)

    await expect(
      setProductImage('p-cookie', { width: 1 } as unknown as ProductImage, database),
    ).rejects.toThrow(/can't be saved/)

    expect((await database.products.get('p-cookie'))?.image).toBeUndefined()
  })

  it('rejects an unknown id', async () => {
    await expect(setProductImage('p-nope', picture(), database)).rejects.toThrow('no longer exists')
    await expect(clearProductImage('p-nope', database)).rejects.toThrow('no longer exists')
  })

  it('removing a picture leaves the product itself exactly as it was', async () => {
    await database.products.bulkAdd(fixtures)

    await setProductImage('p-cookie', picture(), database)
    await clearProductImage('p-cookie', database)

    const stored = await database.products.get('p-cookie')
    expect(stored?.image).toBeUndefined()
    // Still on the menu — removing a photo is never a delete.
    expect(await database.products.count()).toBe(fixtures.length)
    expect(stored?.name).toBe('Cookie')
    expect(stored?.price).toBe(4000)
  })

  it('a product edit keeps the picture, and the picture never reaches an old order', async () => {
    await database.products.bulkAdd(fixtures)
    await setProductImage('p-croissant', picture(), database)
    const order = await completeOrder(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      { method: 'cash', tendered: 10000, change: 4500 },
      database,
    )

    await updateProduct(
      'p-croissant',
      { name: 'Butter Croissant', price: 9900, category: 'cookies' },
      database,
    )

    expect((await database.products.get('p-croissant'))?.image?.blob.size).toBe(2048)
    // The picture changed nothing about the money record.
    expect(await database.orders.get(order.id)).toEqual(order)
    expect((await database.orders.get(order.id))?.lines[0].unitPrice).toBe(5500)
    expect((await database.orders.get(order.id))?.lines[0]).not.toHaveProperty('image')
  })
})
