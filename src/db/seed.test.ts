import { beforeEach, describe, expect, it } from 'vitest'
import { isKnownCategory } from '../domain/categories'
import { isSellable } from '../domain/cart'
import { PosDatabase } from './db'
import { seedIfEmpty, seedProducts } from './seed'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

describe('seedProducts', () => {
  it('is the shop menu, in grid order', () => {
    expect(seedProducts.map((p) => [p.name, p.category, p.sortOrder])).toEqual([
      ['Brownie 9 cubes', 'brownies', 1],
      ['Brownie 21 cubes', 'brownies', 2],
      ['Brownie brittles', 'brownies', 3],
      ['Brownie cups', 'brownies', 4],
      ['Choc chunk', 'cookies', 5],
      ['Macadamia choc', 'cookies', 6],
      ['Manhattan', 'cookies', 7],
      ['Amsterdam cookies', 'cookies', 8],
      ['Seasalt choc mud', 'cookies', 9],
      ['Cake jar', 'jar', 10],
      ['Cookie jar', 'jar', 11],
    ])
  })

  it('prices every product as exact integer satang', () => {
    // The menu is written in baht; what reaches the grid — and every order
    // line snapshotted from it — must be whole satang, never a float.
    expect(seedProducts.map((p) => p.price)).toEqual([
      30000, 68000, 38000, 6000, 12500, 12500, 12500, 12500, 12500, 25000, 38000,
    ])
    for (const p of seedProducts) {
      expect(Number.isSafeInteger(p.price)).toBe(true)
    }
  })

  it('is all sellable, in a known category, with unique ids', () => {
    for (const p of seedProducts) {
      expect(isSellable(p)).toBe(true)
      expect(isKnownCategory(p.category)).toBe(true)
      expect(p.outOfStock).toBe(false)
      expect(p.archived).toBe(false)
    }
    expect(new Set(seedProducts.map((p) => p.id)).size).toBe(seedProducts.length)
  })
})

describe('seedIfEmpty', () => {
  it('fills an empty products table once', async () => {
    await seedIfEmpty(database)
    expect(await database.products.count()).toBe(seedProducts.length)

    await seedIfEmpty(database)
    expect(await database.products.count()).toBe(seedProducts.length)
  })

  it('leaves a device that already has products alone', async () => {
    // A phone upgraded from the old menu keeps the products (and the
    // prices) its owner has been selling — the new menu is only for a
    // fresh install.
    await database.products.add({
      id: 'p-legacy',
      name: 'Sourdough Loaf',
      price: 12000,
      // @ts-expect-error a category saved before the menu changed
      category: 'bread',
      sortOrder: 1,
      outOfStock: false,
      archived: false,
    })

    await seedIfEmpty(database)

    expect(await database.products.count()).toBe(1)
    expect((await database.products.get('p-legacy'))?.name).toBe('Sourdough Loaf')
  })
})
