import { describe, expect, it } from 'vitest'
import { addProduct } from './cart'
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
})
