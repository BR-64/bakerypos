import { describe, expect, it } from 'vitest'
import {
  MAX_STOCK_INPUT,
  isValidStockMovement,
  parseReceivedQty,
  parseStockCount,
  partitionStockMovements,
  planStockChanges,
  readStock,
  saleQuantities,
  stockLabel,
  voidStockDeltas,
  type StockPlanInput,
} from './stock'
import type { StockMovement } from './types'

const product = { id: 'p-a', name: 'A', price: 100, category: 'other', sortOrder: 1 }

describe('readStock', () => {
  it('a product with no stock key is untracked', () => {
    expect(readStock(product)).toEqual({ kind: 'untracked' })
  })

  it.each([
    ['0', 0],
    ['-3', -3],
    ['5', 5],
  ])('stock %s is tracked', (_label, stock) => {
    expect(readStock({ ...product, stock })).toEqual({ kind: 'tracked', level: stock })
  })

  it.each([
    ['NaN', NaN],
    ['1.5', 1.5],
    ["'5'", '5'],
    ['1e300', 1e300],
    ['null', null],
    ['Infinity', Infinity],
    ['a BigInt', 5n],
  ])('stock %s is invalid', (_label, stock) => {
    expect(readStock({ ...product, stock })).toEqual({ kind: 'invalid' })
  })

  it.each([
    ['null', null],
    ['an array', [1, 2]],
    ['a BigInt', 7n],
    ['undefined', undefined],
    ['a string', 'p-a'],
  ])('a %s product is invalid and never throws', (_label, value) => {
    expect(() => readStock(value)).not.toThrow()
    expect(readStock(value)).toEqual({ kind: 'invalid' })
  })
})

describe('parseStockCount', () => {
  it.each([
    ['0', 0],
    ['12', 12],
    [' 7 ', 7],
    ['007', 7],
    [String(MAX_STOCK_INPUT), MAX_STOCK_INPUT],
  ])('accepts %j', (text, value) => {
    expect(parseStockCount(text)).toEqual({ ok: true, value })
  })

  it.each(['-1', '1.5', '', '   ', '100001', 'abc', '1e3', '+5', '9'.repeat(400)])(
    'rejects %j',
    (text) => {
      const result = parseStockCount(text)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.length).toBeGreaterThan(0)
    },
  )
})

describe('parseReceivedQty', () => {
  it.each([
    ['1', 1],
    ['24', 24],
    [String(MAX_STOCK_INPUT), MAX_STOCK_INPUT],
  ])('accepts %j', (text, value) => {
    expect(parseReceivedQty(text)).toEqual({ ok: true, value })
  })

  it.each(['0', '-1', '1.5', '', '100001', '00'])('rejects %j', (text) => {
    expect(parseReceivedQty(text).ok).toBe(false)
  })
})

describe('saleQuantities', () => {
  it('sums qty per product over the valid lines only', () => {
    const quantities = saleQuantities([
      { productId: 'p-a', name: 'A', unitPrice: 100, qty: 2 },
      { productId: 'p-b', name: 'B', unitPrice: 50, qty: 1 },
      { productId: 'p-a', name: 'A', unitPrice: 100, qty: 9 }, // duplicate: invalid
      { productId: 'p-c', name: 'C', unitPrice: 1.5, qty: 1 }, // fractional price: invalid
      null,
    ])
    expect([...quantities]).toEqual([
      ['p-a', 2],
      ['p-b', 1],
    ])
  })

  it.each([
    ['null', null],
    ['an object', { productId: 'p-a' }],
    ['a string', 'lines'],
  ])('%s is no lines', (_label, lines) => {
    expect(saleQuantities(lines).size).toBe(0)
  })
})

function plan(rows: Record<string, unknown>, deltas: Record<string, number>) {
  let n = 0
  const input: StockPlanInput = {
    rows: new Map(Object.entries(rows)),
    deltas: new Map(Object.entries(deltas)),
    kind: 'sale',
    at: '2026-01-15T02:30:00.000Z',
    newId: () => `m-${++n}`,
    orderId: 'o-1',
    orderNumber: 42,
  }
  return planStockChanges(input)
}

describe('planStockChanges', () => {
  it('plans one update and one movement for a tracked product', () => {
    const result = plan({ 'p-a': { ...product, stock: 5 } }, { 'p-a': -2 })
    expect(result.updates).toEqual([{ id: 'p-a', stock: 3 }])
    expect(result.movements).toEqual([
      {
        id: 'm-1',
        productId: 'p-a',
        kind: 'sale',
        delta: -2,
        level: 3,
        previous: 5,
        createdAt: '2026-01-15T02:30:00.000Z',
        orderId: 'o-1',
        orderNumber: 42,
      },
    ])
    expect(result.skipped).toEqual([])
  })

  it('lets the count go below zero', () => {
    expect(plan({ 'p-a': { ...product, stock: 1 } }, { 'p-a': -4 }).updates).toEqual([
      { id: 'p-a', stock: -3 },
    ])
  })

  it('ignores an untracked product silently', () => {
    expect(plan({ 'p-a': product }, { 'p-a': -1 })).toEqual({
      updates: [],
      movements: [],
      skipped: [],
    })
  })

  it.each([
    ['a missing row', undefined, /not found/],
    ['a null row', null, /not found/],
    ['an array row', [1], /unreadable/],
    ["stock 'abc'", { ...product, stock: 'abc' }, /unreadable/],
    ['stock 1.5', { ...product, stock: 1.5 }, /unreadable/],
    ['stock null', { ...product, stock: null }, /unreadable/],
    ['an overflow', { ...product, stock: Number.MIN_SAFE_INTEGER }, /safe range/],
  ])('skips %s with a reason, writing nothing for it', (_label, row, reason) => {
    const result = plan(
      { 'p-a': row, 'p-b': { ...product, id: 'p-b', stock: 2 } },
      {
        'p-a': -1,
        'p-b': -1,
      },
    )
    expect(result.skipped).toEqual([{ productId: 'p-a', reason: expect.stringMatching(reason) }])
    // The good product in the same order still moves.
    expect(result.updates).toEqual([{ id: 'p-b', stock: 1 }])
    expect(result.movements.map((m) => m.productId)).toEqual(['p-b'])
  })

  it('skips a delta that is not a safe integer', () => {
    const result = plan({ 'p-a': { ...product, stock: 5 } }, { 'p-a': 0.5 })
    expect(result.updates).toEqual([])
    expect(result.skipped).toHaveLength(1)
  })

  it('omits orderId/orderNumber when not given', () => {
    const result = planStockChanges({
      rows: new Map([['p-a', { ...product, stock: 1 }]]),
      deltas: new Map([['p-a', 3]]),
      kind: 'received',
      at: '2026-01-15T02:30:00.000Z',
      newId: () => 'm',
    })
    expect(result.movements[0]).not.toHaveProperty('orderId')
    expect(result.movements[0]).not.toHaveProperty('orderNumber')
    expect(isValidStockMovement(result.movements[0])).toBe(true)
  })

  it('never throws, whatever the rows hold', () => {
    const rows: Record<string, unknown> = {
      a: 7n,
      b: 'x',
      c: { stock: 5n },
      d: { stock: { valueOf: () => 3 } },
      e: Object.create(null),
    }
    expect(() => plan(rows, { a: -1, b: -1, c: -1, d: -1, e: -1 })).not.toThrow()
  })
})

const sale = (overrides: Partial<StockMovement> = {}): StockMovement => ({
  id: 'm-1',
  productId: 'p-a',
  kind: 'sale',
  delta: -2,
  level: 3,
  previous: 5,
  createdAt: '2026-01-15T02:30:00.000Z',
  orderId: 'o-1',
  orderNumber: 42,
  ...overrides,
})

describe('voidStockDeltas', () => {
  it('adds back the negated sum of the sale deltas per product', () => {
    const result = voidStockDeltas([
      sale(),
      sale({ id: 'm-2', productId: 'p-b', delta: -1, level: 0, previous: 1 }),
    ])
    expect(result.alreadyVoided).toBe(false)
    expect([...result.deltas]).toEqual([
      ['p-a', 2],
      ['p-b', 1],
    ])
  })

  it('does nothing once a void movement exists', () => {
    const result = voidStockDeltas([
      sale(),
      sale({ id: 'm-2', kind: 'void', delta: 2, level: 5, previous: 3 }),
    ])
    expect(result).toEqual({ alreadyVoided: true, deltas: new Map(), skipped: [] })
  })

  it('no movements (sold while untracked) → nothing to add back', () => {
    expect(voidStockDeltas([]).deltas.size).toBe(0)
  })

  it('skips an unreadable sale movement with a reason', () => {
    const result = voidStockDeltas([sale({ delta: 'x' as unknown as number }), null])
    expect(result.deltas.size).toBe(0)
    expect(result.skipped).toHaveLength(2)
  })
})

describe('isValidStockMovement / partitionStockMovements', () => {
  it('accepts well-formed rows of every kind', () => {
    expect(isValidStockMovement(sale())).toBe(true)
    expect(
      isValidStockMovement({
        id: 'm',
        productId: 'p',
        kind: 'set',
        delta: 5,
        level: 5,
        previous: null,
        createdAt: '2026-01-15T02:30:00.000Z',
      }),
    ).toBe(true)
  })

  it.each([
    ['null', null],
    ['an array', []],
    ['an unknown kind', sale({ kind: 'theft' as never })],
    ['a fractional delta', sale({ delta: -1.5 })],
    ['a level that does not add up', sale({ level: 4 })],
    ['an unparseable createdAt', sale({ createdAt: 'yesterday' })],
    ['a sale with no orderId', sale({ orderId: undefined })],
    ['a zero orderNumber', sale({ orderNumber: 0 })],
    ['a string previous', sale({ previous: '5' as unknown as number })],
  ])('rejects %s', (_label, value) => {
    expect(isValidStockMovement(value)).toBe(false)
  })

  it('partitions, keeping order', () => {
    const good = sale()
    const bad = sale({ id: '' })
    expect(partitionStockMovements([bad, good, 3])).toEqual({ valid: [good], invalid: [bad, 3] })
  })
})

describe('stockLabel', () => {
  it.each([
    [5, 'Stock: 5', false],
    [1, 'Stock: 1', false],
    [0, 'Stock: 0', true],
    [-2, 'Stock: -2', true],
  ])('%d → %s (low %s)', (level, text, low) => {
    expect(stockLabel(level)).toEqual({ text, low })
  })
})
