import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER, categoryLabel, productsInCategory, visibleCategories } from './categories'
import type { Product } from './types'

function product(overrides: Partial<Product>): Product {
  return {
    id: 'p-x',
    name: 'X',
    price: 1000,
    category: 'cookies',
    sortOrder: 1,
    outOfStock: false,
    archived: false,
    ...overrides,
  }
}

describe('categoryLabel', () => {
  it('returns an English label for each known category', () => {
    expect(categoryLabel('brownies')).toBe('Brownies')
    expect(categoryLabel('cookies')).toBe('Soft cookies')
    expect(categoryLabel('jar')).toBe('Jar')
    expect(categoryLabel('other')).toBe('Other')
  })

  it('falls back to a safe label for an unknown category instead of throwing', () => {
    // @ts-expect-error deliberately bad data
    expect(() => categoryLabel('nonsense')).not.toThrow()
    // @ts-expect-error deliberately bad data
    expect(categoryLabel('nonsense')).toBe('Other')
    // @ts-expect-error deliberately bad data
    expect(categoryLabel(undefined)).toBe('Other')
  })
})

describe('visibleCategories', () => {
  it('returns only categories with at least one product, in CATEGORY_ORDER order', () => {
    const products = [
      product({ id: 'p1', category: 'jar' }),
      product({ id: 'p2', category: 'brownies' }),
    ]
    expect(visibleCategories(products)).toEqual(['brownies', 'jar'])
  })

  it('follows the fixed CATEGORY_ORDER regardless of input order', () => {
    const products = CATEGORY_ORDER.map((category, i) => product({ id: `p${i}`, category }))
    expect(visibleCategories(products.reverse())).toEqual(CATEGORY_ORDER)
  })

  it('still shows a category whose only product is out of stock', () => {
    const products = [product({ id: 'p1', category: 'jar', outOfStock: true })]
    expect(visibleCategories(products)).toEqual(['jar'])
  })

  it('returns an empty list for no products', () => {
    expect(visibleCategories([])).toEqual([])
  })

  it("follows the shop's stored order when one is given (Admin's category order)", () => {
    const products = CATEGORY_ORDER.map((category, i) => product({ id: `p${i}`, category }))

    expect(visibleCategories(products, ['jar', 'other', 'brownies', 'cookies'])).toEqual([
      'jar',
      'other',
      'brownies',
      'cookies',
    ])
  })

  it('appends, never hides, a category the stored order left out or repeated', () => {
    const products = CATEGORY_ORDER.map((category, i) => product({ id: `p${i}`, category }))

    // @ts-expect-error a stored order is untrusted data
    expect(visibleCategories(products, ['jar', 'jar', 'nonsense'])).toEqual([
      'jar',
      'brownies',
      'cookies',
      'other',
    ])
  })

  it('ignores a product with an unknown or missing category instead of throwing', () => {
    const products = [
      product({ id: 'p1', category: 'brownies' }),
      // @ts-expect-error deliberately bad data
      product({ id: 'p2', category: 'nonsense' }),
      product({ id: 'p3', category: undefined }),
    ]
    expect(() => visibleCategories(products)).not.toThrow()
    expect(visibleCategories(products)).toEqual(['brownies'])
  })
})

describe('productsInCategory', () => {
  it('returns every product for the "all" tab', () => {
    const products = [
      product({ id: 'p1', category: 'brownies' }),
      product({ id: 'p2', category: 'jar' }),
    ]
    expect(productsInCategory(products, 'all')).toEqual(products)
  })

  it('filters to the selected category, keeping sortOrder', () => {
    const products = [
      product({ id: 'p1', category: 'brownies', sortOrder: 2 }),
      product({ id: 'p2', category: 'jar', sortOrder: 1 }),
      product({ id: 'p3', category: 'brownies', sortOrder: 1 }),
    ]
    expect(productsInCategory(products, 'brownies').map((p) => p.id)).toEqual(['p1', 'p3'])
  })

  it('a product with category: null renders under "all" only (regression)', () => {
    // @ts-expect-error deliberately bad data
    const bad = product({ id: 'p-null', category: null })
    const products = [product({ id: 'p1', category: 'brownies' }), bad]
    expect(() => visibleCategories(products)).not.toThrow()
    expect(visibleCategories(products)).toEqual(['brownies'])
    expect(productsInCategory(products, 'all')).toEqual(products)
    expect(productsInCategory(products, 'brownies')).toEqual([products[0]])
  })

  it('a product left on a device with a category from the old menu still shows under "all"', () => {
    // Products already on a phone keep whatever category they were saved
    // with. Those names are no longer categories, so they must behave like
    // any other unknown value: neutral label, no tab of their own, and
    // never missing from the grid.
    // @ts-expect-error a product read from the device is untrusted data
    const legacy = product({ id: 'p-legacy', category: 'bread' })
    const products = [product({ id: 'p1', category: 'brownies' }), legacy]

    expect(categoryLabel(legacy.category)).toBe('Other')
    expect(visibleCategories(products)).toEqual(['brownies'])
    expect(productsInCategory(products, 'all')).toEqual(products)
    expect(productsInCategory(products, 'brownies')).toEqual([products[0]])
  })

  it('a product with an unknown category never appears under a named tab, but still appears under "all"', () => {
    // @ts-expect-error deliberately bad data
    const bad = product({ id: 'p-bad', category: 'nonsense' })
    const products = [product({ id: 'p1', category: 'brownies' }), bad]
    expect(productsInCategory(products, 'brownies')).toEqual([products[0]])
    expect(productsInCategory(products, 'all')).toEqual(products)
  })
})
