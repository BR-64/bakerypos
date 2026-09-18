import { describe, expect, it } from 'vitest'
import { addProduct, canAddProduct, clear, decrement, increment, itemCount, remove } from './cart'
import { cartTotal } from './money'
import type { CartLine, Product } from './types'

/**
 * Deep-freezes `lines` (the array and each line object) so that any
 * implementation which mutates in place (e.g. `existing.qty++`) throws in
 * this strict-mode test module, instead of silently passing.
 */
function freezeLines(lines: CartLine[]): CartLine[] {
  lines.forEach((l) => Object.freeze(l))
  Object.freeze(lines)
  return lines
}

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

  it('never mutates the input on the bump path, and untouched lines keep identity', () => {
    const croissantLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 1,
    }
    const cookieLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 }
    const input = freezeLines([croissantLine, cookieLine])
    const before = structuredClone(input)

    const out = addProduct(input, croissant)

    expect(input).toEqual(before)
    expect(out).not.toBe(input)
    expect(out[0]).not.toBe(croissantLine)
    expect(out[0].qty).toBe(2)
    expect(out[1]).toBe(cookieLine)
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

  it('bumps qty using the existing snapshot even if the product price has since become non-integer', () => {
    const lines = addProduct(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      { ...croissant, price: 55.5 },
    )
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
  })
})

describe('canAddProduct', () => {
  it('is true for a product not yet in the cart with an integer price', () => {
    expect(canAddProduct([], croissant)).toBe(true)
  })

  it('is false for a product not yet in the cart with a non-integer price', () => {
    expect(canAddProduct([], { ...croissant, price: 55.5 })).toBe(false)
  })

  it('is true for a product already in the cart, even with a non-integer price', () => {
    const lines = [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }]
    expect(canAddProduct(lines, { ...croissant, price: 55.5 })).toBe(true)
  })

  it('is true for an archived or out-of-stock product regardless of price', () => {
    expect(canAddProduct([], { ...croissant, archived: true, price: 55.5 })).toBe(true)
    expect(canAddProduct([], { ...croissant, outOfStock: true, price: 55.5 })).toBe(true)
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

  it('never mutates the input, and untouched lines keep identity', () => {
    const croissantLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 1,
    }
    const cookieLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 }
    const input = freezeLines([croissantLine, cookieLine])
    const before = structuredClone(input)

    const out = increment(input, 'p-croissant')

    expect(input).toEqual(before)
    expect(out[0]).not.toBe(croissantLine)
    expect(out[0].qty).toBe(2)
    expect(out[1]).toBe(cookieLine)
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

  it('never mutates the input on the qty>1 path, and untouched lines keep identity', () => {
    const croissantLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 2,
    }
    const cookieLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 }
    const input = freezeLines([croissantLine, cookieLine])
    const before = structuredClone(input)

    const out = decrement(input, 'p-croissant')

    expect(input).toEqual(before)
    expect(out[0]).not.toBe(croissantLine)
    expect(out[0].qty).toBe(1)
    expect(out[1]).toBe(cookieLine)
  })

  it('removes the line once qty reaches 0', () => {
    const lines = decrement(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      'p-croissant',
    )
    expect(lines).toEqual([])
  })

  it('never mutates the input on the removal path, and untouched lines keep identity', () => {
    const croissantLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 1,
    }
    const cookieLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 2 }
    const input = freezeLines([croissantLine, cookieLine])
    const before = structuredClone(input)

    const out = decrement(input, 'p-croissant')

    expect(input).toEqual(before)
    expect(out).toEqual([cookieLine])
    expect(out[0]).toBe(cookieLine)
  })

  it('removes a line through a full add/decrement sequence, keeping qty an integer >= 1 at every step', () => {
    let lines = addProduct(addProduct([], croissant), croissant)
    expect(lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])

    for (let i = 0; i < 5; i++) {
      lines = decrement(lines, 'p-croissant')
      if (lines.length > 0) {
        expect(Number.isInteger(lines[0].qty)).toBe(true)
        expect(lines[0].qty).toBeGreaterThanOrEqual(1)
      }
    }

    expect(lines).toEqual([])
  })

  it('removes a malformed qty:0 line instead of decrementing it to -1', () => {
    const lines = decrement(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 0 }],
      'p-croissant',
    )
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
