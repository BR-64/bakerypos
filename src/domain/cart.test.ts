import { describe, expect, it } from 'vitest'
import {
  addProduct,
  clear,
  decrement,
  increment,
  isSellable,
  isValidCartLine,
  itemCount,
  partitionCartLines,
  partitionSellable,
  remove,
} from './cart'
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

  it('is a no-op — same reference, qty unchanged — for an archived product even when it already has a line in the cart', () => {
    const input: CartLine[] = [
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ]
    const out = addProduct(input, { ...croissant, archived: true })
    expect(out).toBe(input)
    expect(out[0].qty).toBe(1)
  })

  it('is a no-op — same reference, qty unchanged — for an out-of-stock product even when it already has a line in the cart', () => {
    const input: CartLine[] = [
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ]
    const out = addProduct(input, { ...croissant, outOfStock: true })
    expect(out).toBe(input)
    expect(out[0].qty).toBe(1)
  })

  it('returns lines unchanged (same reference), never throws, for a new line with a non-integer price', () => {
    const input: CartLine[] = []
    expect(() => addProduct(input, { ...croissant, price: 55.5 })).not.toThrow()
    expect(addProduct(input, { ...croissant, price: 55.5 })).toBe(input)
  })

  it('returns lines unchanged, never throws, for a new line with a negative price', () => {
    const input: CartLine[] = []
    expect(addProduct(input, { ...croissant, price: -100 })).toBe(input)
  })

  it('returns lines unchanged, never throws, for a new line with an empty name', () => {
    const input: CartLine[] = []
    expect(addProduct(input, { ...croissant, name: '' })).toBe(input)
  })

  it('returns lines unchanged, never throws, when archived is a non-boolean value (e.g. the string "false")', () => {
    // A non-boolean archived value must not be read for truthiness (the
    // string "false" is truthy); it's simply invalid data, caught by
    // isSellable, and the line is skipped either way.
    const input: CartLine[] = []
    // @ts-expect-error deliberately bad data
    expect(addProduct(input, { ...croissant, archived: 'false' })).toBe(input)
  })

  it('returns lines unchanged, never throws, when outOfStock is a non-boolean value', () => {
    const input: CartLine[] = []
    // @ts-expect-error deliberately bad data
    expect(addProduct(input, { ...croissant, outOfStock: 'false' })).toBe(input)
  })

  it('returns lines unchanged, never throws, for a missing id', () => {
    const input: CartLine[] = []
    // @ts-expect-error deliberately bad data
    expect(addProduct(input, { ...croissant, id: undefined })).toBe(input)
  })

  it('returns lines unchanged, never throws, for a non-finite sortOrder', () => {
    const input: CartLine[] = []
    expect(addProduct(input, { ...croissant, sortOrder: NaN })).toBe(input)
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

describe('isSellable', () => {
  it('is true for a well-formed product', () => {
    expect(isSellable(croissant)).toBe(true)
  })

  it('is false for a non-integer price', () => {
    expect(isSellable({ ...croissant, price: 55.5 })).toBe(false)
  })

  it('is false for a negative price', () => {
    expect(isSellable({ ...croissant, price: -100 })).toBe(false)
  })

  it('is false for a NaN price', () => {
    expect(isSellable({ ...croissant, price: NaN })).toBe(false)
  })

  it('is false for a missing price', () => {
    // @ts-expect-error deliberately bad data
    expect(isSellable({ ...croissant, price: undefined })).toBe(false)
  })

  it('is false for an empty or whitespace-only name', () => {
    expect(isSellable({ ...croissant, name: '' })).toBe(false)
    expect(isSellable({ ...croissant, name: '   ' })).toBe(false)
  })

  it('is false for a missing name', () => {
    // @ts-expect-error deliberately bad data
    expect(isSellable({ ...croissant, name: undefined })).toBe(false)
  })

  it('is true for a free (price 0) product', () => {
    expect(isSellable({ ...croissant, price: 0 })).toBe(true)
  })

  it('is false for a missing id', () => {
    // @ts-expect-error deliberately bad data
    expect(isSellable({ ...croissant, id: undefined })).toBe(false)
  })

  it('is false for an empty id', () => {
    expect(isSellable({ ...croissant, id: '' })).toBe(false)
  })

  it('is false for a non-finite sortOrder', () => {
    expect(isSellable({ ...croissant, sortOrder: NaN })).toBe(false)
    expect(isSellable({ ...croissant, sortOrder: Infinity })).toBe(false)
    // @ts-expect-error deliberately bad data
    expect(isSellable({ ...croissant, sortOrder: undefined })).toBe(false)
  })

  it('is false when archived is present but not a boolean', () => {
    // @ts-expect-error deliberately bad data
    expect(isSellable({ ...croissant, archived: 'false' })).toBe(false)
  })

  it('is false when outOfStock is present but not a boolean', () => {
    // @ts-expect-error deliberately bad data
    expect(isSellable({ ...croissant, outOfStock: 'false' })).toBe(false)
  })

  it('is true when archived/outOfStock are absent (undefined is not "present")', () => {
    const { archived: _archived, outOfStock: _outOfStock, ...rest } = croissant
    // @ts-expect-error deliberately missing fields
    expect(isSellable(rest)).toBe(true)
  })
})

describe('partitionSellable', () => {
  it('splits well-formed products into sellable and invalid ones into invalid', () => {
    const badPrice = { ...croissant, id: 'p-bad', price: -1 }
    const { sellable, invalid } = partitionSellable([croissant, cookie, badPrice])
    expect(sellable).toEqual([croissant, cookie])
    expect(invalid).toEqual([badPrice])
  })

  it('returns empty arrays for no products', () => {
    expect(partitionSellable([])).toEqual({ sellable: [], invalid: [] })
  })

  it('out-of-stock products are sellable (valid data), not invalid', () => {
    const outOfStock = { ...croissant, outOfStock: true }
    expect(partitionSellable([outOfStock])).toEqual({ sellable: [outOfStock], invalid: [] })
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

const croissantLine: CartLine = { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }

describe('isValidCartLine', () => {
  it('is true for a well-formed line', () => {
    expect(isValidCartLine(croissantLine)).toBe(true)
  })

  it('is false for null', () => {
    expect(isValidCartLine(null)).toBe(false)
  })

  it('is false for a non-object value', () => {
    expect(isValidCartLine('not a line')).toBe(false)
    expect(isValidCartLine(42)).toBe(false)
    expect(isValidCartLine(undefined)).toBe(false)
  })

  it('is false for a missing productId', () => {
    const { productId: _productId, ...rest } = croissantLine
    expect(isValidCartLine(rest)).toBe(false)
  })

  it('is false for an empty productId', () => {
    expect(isValidCartLine({ ...croissantLine, productId: '' })).toBe(false)
  })

  it('is false for a blank (whitespace-only) name', () => {
    expect(isValidCartLine({ ...croissantLine, name: '   ' })).toBe(false)
  })

  it('is false for a non-integer unitPrice (55.5)', () => {
    expect(isValidCartLine({ ...croissantLine, unitPrice: 55.5 })).toBe(false)
  })

  it('is false for a negative unitPrice (-1)', () => {
    expect(isValidCartLine({ ...croissantLine, unitPrice: -1 })).toBe(false)
  })

  it('is false for a NaN unitPrice', () => {
    expect(isValidCartLine({ ...croissantLine, unitPrice: NaN })).toBe(false)
  })

  it('is false for a string unitPrice ("5500")', () => {
    expect(isValidCartLine({ ...croissantLine, unitPrice: '5500' })).toBe(false)
  })

  it('is false for qty 0', () => {
    expect(isValidCartLine({ ...croissantLine, qty: 0 })).toBe(false)
  })

  it('is false for a negative qty (-1)', () => {
    expect(isValidCartLine({ ...croissantLine, qty: -1 })).toBe(false)
  })

  it('is false for a non-integer qty (1.5)', () => {
    expect(isValidCartLine({ ...croissantLine, qty: 1.5 })).toBe(false)
  })

  it('is false for a NaN qty', () => {
    expect(isValidCartLine({ ...croissantLine, qty: NaN })).toBe(false)
  })

  it('is false when unitPrice * qty is not a safe integer', () => {
    expect(
      isValidCartLine({ ...croissantLine, unitPrice: Number.MAX_SAFE_INTEGER, qty: 2 }),
    ).toBe(false)
  })

  it('is true for a zero unitPrice (free item)', () => {
    expect(isValidCartLine({ ...croissantLine, unitPrice: 0 })).toBe(true)
  })
})

describe('partitionCartLines', () => {
  it('splits well-formed lines into valid and invalid ones, preserving order', () => {
    const cookieLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 }
    const badLine = { ...croissantLine, productId: '' }
    const { valid, invalid } = partitionCartLines([croissantLine, badLine, cookieLine])
    expect(valid).toEqual([croissantLine, cookieLine])
    expect(invalid).toEqual([badLine])
  })

  it('returns empty arrays for no lines', () => {
    expect(partitionCartLines([])).toEqual({ valid: [], invalid: [] })
  })
})
