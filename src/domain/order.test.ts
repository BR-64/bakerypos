import { describe, expect, it } from 'vitest'
import { isValidOrder, partitionOrders } from './order'
import type { Order } from './types'

const validCashOrder: Order = {
  id: 'o-1',
  number: 1,
  lines: [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }],
  total: 11000,
  payment: { method: 'cash', tendered: 11000, change: 0 },
  status: 'completed',
  createdAt: '2026-01-15T10:00:00.000Z',
  sync: 'pending',
}

const validPromptPayOrder: Order = {
  ...validCashOrder,
  id: 'o-2',
  payment: { method: 'promptpay', confirmedAt: '2026-01-15T10:05:00.000Z' },
}

const validVoidedOrder: Order = {
  ...validCashOrder,
  id: 'o-3',
  status: 'voided',
  voidedAt: '2026-01-15T11:00:00.000Z',
  voidReason: 'customer changed mind',
}

describe('isValidOrder', () => {
  it('accepts a well-formed cash order', () => {
    expect(isValidOrder(validCashOrder)).toBe(true)
  })

  it('accepts a well-formed promptpay order', () => {
    expect(isValidOrder(validPromptPayOrder)).toBe(true)
  })

  it('accepts a well-formed voided order', () => {
    expect(isValidOrder(validVoidedOrder)).toBe(true)
  })

  it.each([
    ['NaN total', { ...validCashOrder, total: NaN }],
    ['negative total', { ...validCashOrder, total: -1 }],
    ['a total beyond MAX_SAFE_INTEGER', { ...validCashOrder, total: 1e18 }],
    ['a fractional total', { ...validCashOrder, total: 55.5 }],
  ])('rejects %s', (_label, order) => {
    expect(isValidOrder(order)).toBe(false)
  })

  it.each([
    ['a missing id', { ...validCashOrder, id: undefined }],
    ['an empty id', { ...validCashOrder, id: '' }],
    ['number 0', { ...validCashOrder, number: 0 }],
    ['a negative number', { ...validCashOrder, number: -1 }],
    ['a fractional number', { ...validCashOrder, number: 1.5 }],
  ])('rejects %s', (_label, order) => {
    expect(isValidOrder(order)).toBe(false)
  })

  it.each([
    ['a missing createdAt', { ...validCashOrder, createdAt: undefined }],
    ['an empty createdAt', { ...validCashOrder, createdAt: '' }],
    ['an unparseable createdAt', { ...validCashOrder, createdAt: 'not a date' }],
    ['a non-string createdAt', { ...validCashOrder, createdAt: 1234567890 }],
  ])('rejects %s', (_label, order) => {
    expect(isValidOrder(order)).toBe(false)
  })

  it.each([
    ['an unknown status', { ...validCashOrder, status: 'refunded' }],
    ['a missing status', { ...validCashOrder, status: undefined }],
  ])('rejects %s', (_label, order) => {
    expect(isValidOrder(order)).toBe(false)
  })

  it.each([
    ['a missing payment', { ...validCashOrder, payment: undefined }],
    ['a null payment', { ...validCashOrder, payment: null }],
    ['an unknown payment method', { ...validCashOrder, payment: { method: 'crypto' } }],
    ['cash without tendered', { ...validCashOrder, payment: { method: 'cash', change: 0 } }],
    ['cash without change', { ...validCashOrder, payment: { method: 'cash', tendered: 11000 } }],
    [
      'cash with a negative change',
      { ...validCashOrder, payment: { method: 'cash', tendered: 11000, change: -1 } },
    ],
    [
      'cash with a fractional tendered',
      { ...validCashOrder, payment: { method: 'cash', tendered: 11000.5, change: 0.5 } },
    ],
    ['promptpay without confirmedAt', { ...validCashOrder, payment: { method: 'promptpay' } }],
    [
      'promptpay with an unparseable confirmedAt',
      { ...validCashOrder, payment: { method: 'promptpay', confirmedAt: 'whenever' } },
    ],
  ])('rejects %s', (_label, order) => {
    expect(isValidOrder(order)).toBe(false)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', [validCashOrder]],
    ['a bare BigInt', 10n],
    ['a string', 'not an order'],
    ['a number', 42],
  ])('never throws for %s, and rejects it', (_label, value) => {
    expect(() => isValidOrder(value)).not.toThrow()
    expect(isValidOrder(value)).toBe(false)
  })

  it('never throws for an object with a circular reference (extra fields do not affect validity)', () => {
    const order: Record<string, unknown> = { ...validCashOrder }
    order.self = order
    expect(() => isValidOrder(order)).not.toThrow()
    expect(isValidOrder(order)).toBe(true)
  })
})

describe('partitionOrders', () => {
  it('splits valid and invalid orders, keeping input order within each group', () => {
    const bad1 = { ...validCashOrder, id: 'o-bad-1', total: NaN }
    const bad2 = null
    const result = partitionOrders([validCashOrder, bad1, validPromptPayOrder, bad2])

    expect(result.valid).toEqual([validCashOrder, validPromptPayOrder])
    expect(result.invalid).toEqual([bad1, bad2])
  })

  it('returns empty arrays for an empty input, and never throws on a fully-corrupt list', () => {
    expect(partitionOrders([])).toEqual({ valid: [], invalid: [] })
    expect(() => partitionOrders([null, undefined, 1n, 'x', []])).not.toThrow()
  })
})
