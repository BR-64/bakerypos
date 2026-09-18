import { describe, expect, it } from 'vitest'
import { addProduct, clear, decrement, increment, itemCount, remove } from './cart'
import { cartTotal } from './money'
import type { CartLine, Product } from './types'

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'pastry',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

const cookie: Product = {
  id: 'p-cookie',
  name: 'Cookie',
  price: 4000,
  category: 'pastry',
  sortOrder: 2,
  outOfStock: false,
  archived: false,
}

describe('addProduct', () => {
  it('adds a new line for a product not yet in the cart', () => {
    const lines = addProduct([], croissant)
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])
  })

  it('bumps qty when the product is already in the cart', () => {
    const lines = addProduct(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      croissant,
    )
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
  })

  it('never mutates the input array', () => {
    const input: CartLine[] = []
    const lines = addProduct(input, croissant)
    expect(input).toEqual([])
    expect(lines).not.toBe(input)
  })

  it('keeps lines for different products separate', () => {
    const lines = addProduct(addProduct([], croissant), cookie)
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
      { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 },
    ])
  })

  it('is a no-op for an archived product', () => {
    const input: CartLine[] = []
    expect(addProduct(input, { ...croissant, archived: true })).toBe(input)
  })

  it('is a no-op for an out-of-stock product', () => {
    const input: CartLine[] = []
    expect(addProduct(input, { ...croissant, outOfStock: true })).toBe(input)
  })

  it('throws on a non-integer price', () => {
    expect(() => addProduct([], { ...croissant, price: 55.5 })).toThrow('integer')
  })

  it('keeps the snapshot price when re-adding a product whose price changed', () => {
    const lines = addProduct(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      {
        ...croissant,
        price: 6000,
      },
    )
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
  })

  it('keeps the snapshot name when re-adding a renamed product', () => {
    const lines = addProduct(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      {
        ...croissant,
        name: 'Renamed Croissant',
      },
    )
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
  })
})

describe('increment', () => {
  it('bumps qty by 1', () => {
    const lines = increment(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      'p-croissant',
    )
    expect(lines[0].qty).toBe(2)
  })

  it('returns the same reference for an unknown productId', () => {
    const input: CartLine[] = [
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ]
    expect(increment(input, 'nope')).toBe(input)
  })
})

describe('decrement', () => {
  it('drops qty by 1', () => {
    const lines = decrement(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }],
      'p-croissant',
    )
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])
  })

  it('removes the line once qty reaches 0', () => {
    const lines = decrement(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      'p-croissant',
    )
    expect(lines).toEqual([])
  })

  it('never goes negative', () => {
    const lines = decrement([], 'p-croissant')
    expect(lines).toEqual([])
  })

  it('returns the same reference for an unknown productId', () => {
    const input: CartLine[] = [
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ]
    expect(decrement(input, 'nope')).toBe(input)
  })
})

describe('remove', () => {
  it('removes the line regardless of qty', () => {
    const lines = remove(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 3 }],
      'p-croissant',
    )
    expect(lines).toEqual([])
  })

  it('returns the same reference for an unknown productId', () => {
    const input: CartLine[] = [
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ]
    expect(remove(input, 'nope')).toBe(input)
  })
})

describe('clear', () => {
  it('returns an empty cart', () => {
    expect(clear()).toEqual([])
  })
})

describe('itemCount', () => {
  it('sums qty across lines', () => {
    expect(itemCount([])).toBe(0)
    expect(
      itemCount([
        { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
        { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 3 },
      ]),
    ).toBe(5)
  })
})

describe('cartTotal of a mixed cart', () => {
  it('sums unitPrice * qty across lines in integer satang', () => {
    const lines = addProduct(addProduct(addProduct([], croissant), croissant), cookie)
    expect(itemCount(lines)).toBe(3)
    expect(cartTotal(lines)).toBe(15000)
  })
})
