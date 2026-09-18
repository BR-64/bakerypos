import { beforeEach, describe, expect, it } from 'vitest'
import type { Product } from '../domain/types'
import { PosDatabase } from './db'
import { sellableProducts } from './products'

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
    category: 'pastry',
    sortOrder: 3,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-croissant',
    name: 'Croissant',
    price: 5500,
    category: 'pastry',
    sortOrder: 1,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-old-cake',
    name: 'Discontinued Cake',
    price: 7500,
    category: 'cake',
    sortOrder: 2,
    outOfStock: false,
    archived: true,
  },
  {
    id: 'p-sourdough',
    name: 'Sourdough Loaf',
    price: 12000,
    category: 'bread',
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
})
