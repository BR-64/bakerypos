import { describe, expect, it } from 'vitest'
import {
  MAX_PRODUCT_NAME_LENGTH,
  MAX_PRODUCT_PRICE,
  validateProductDraft,
  type ProductDraft,
} from './productDraft'

const draft = (overrides: Partial<ProductDraft> = {}): ProductDraft => ({
  name: 'Croissant',
  price: '55',
  category: 'cookies',
  ...overrides,
})

describe('validateProductDraft', () => {
  it('turns a good draft into integer satang', () => {
    expect(validateProductDraft(draft())).toEqual({
      ok: true,
      values: { name: 'Croissant', price: 5500, category: 'cookies' },
    })
  })

  it('accepts two decimals and a free item, still as integers', () => {
    expect(validateProductDraft(draft({ price: '45.50' }))).toMatchObject({
      ok: true,
      values: { price: 4550 },
    })
    expect(validateProductDraft(draft({ price: '0' }))).toMatchObject({
      ok: true,
      values: { price: 0 },
    })
  })

  it('trims the name', () => {
    expect(validateProductDraft(draft({ name: '  Baguette  ' }))).toMatchObject({
      ok: true,
      values: { name: 'Baguette' },
    })
  })

  it('rejects an empty or over-long name', () => {
    expect(validateProductDraft(draft({ name: '   ' }))).toEqual({
      ok: false,
      error: 'Enter a product name.',
    })
    expect(validateProductDraft(draft({ name: 'x'.repeat(MAX_PRODUCT_NAME_LENGTH + 1) })).ok).toBe(
      false,
    )
    expect(validateProductDraft(draft({ name: 'x'.repeat(MAX_PRODUCT_NAME_LENGTH) })).ok).toBe(true)
  })

  it('rejects a price that is not a plain baht amount', () => {
    for (const price of ['', 'free', '-5', '45.555', '4 5', '1e3', '๔๕']) {
      expect(validateProductDraft(draft({ price }))).toEqual({
        ok: false,
        error: 'Enter a price in baht, e.g. 45 or 45.50.',
      })
    }
  })

  it('rejects an implausibly large price before it can reach an order line', () => {
    expect(validateProductDraft(draft({ price: '100000' })).ok).toBe(true)
    expect(validateProductDraft(draft({ price: '100001' })).ok).toBe(false)
    expect(MAX_PRODUCT_PRICE).toBe(10_000_000)
  })

  it('rejects an unknown or empty category', () => {
    expect(validateProductDraft(draft({ category: 'sandwiches' }))).toEqual({
      ok: false,
      error: 'Choose a category.',
    })
    expect(validateProductDraft(draft({ category: '' })).ok).toBe(false)
  })

  it('never throws on junk field values', () => {
    // @ts-expect-error a form can hand us anything after a bad render
    expect(() => validateProductDraft({ name: null, price: undefined, category: 7 })).not.toThrow()
    // @ts-expect-error same
    expect(validateProductDraft({ name: null, price: undefined, category: 7 }).ok).toBe(false)
  })
})
