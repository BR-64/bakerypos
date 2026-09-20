import { describe, expect, it } from 'vitest'
import { buildZReport, formatZReport } from './report'
import type { CartLine, Order, Payment } from './types'

const day = new Date(2026, 0, 15, 12, 0)

const croissant: CartLine = { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }
const baguette: CartLine = { productId: 'p-baguette', name: 'Baguette', unitPrice: 6000, qty: 1 }

const cash = (tendered: number, change: number): Payment => ({ method: 'cash', tendered, change })
const promptpay = (at: Date): Payment => ({ method: 'promptpay', confirmedAt: at.toISOString() })

let nextNumber = 1

function makeOrder(overrides: Partial<Order> = {}): Order {
  const lines = overrides.lines ?? [croissant]
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0)
  return {
    id: `o-${nextNumber}`,
    number: nextNumber++,
    lines,
    total,
    payment: cash(total, 0),
    status: 'completed',
    createdAt: new Date(2026, 0, 15, 10, 0).toISOString(),
    sync: 'pending',
    ...overrides,
  }
}

describe('buildZReport — totals', () => {
  it('counts completed orders and sums their stored totals, split by method', () => {
    const orders = [
      makeOrder({ lines: [{ ...croissant, qty: 2 }], payment: cash(20000, 9000) }), // ฿110 cash
      makeOrder({ lines: [baguette], payment: promptpay(day) }), // ฿60 promptpay
      makeOrder({ lines: [croissant], payment: cash(5500, 0) }), // ฿55 cash
    ]

    const report = buildZReport(orders, day)

    expect(report.dayKey).toBe('2026-01-15')
    expect(report.orderCount).toBe(3)
    expect(report.total).toBe(22500)
    expect(report.cashTotal).toBe(16500)
    expect(report.promptPayTotal).toBe(6000)
    expect(report.voidedCount).toBe(0)
    expect(report.voidedTotal).toBe(0)
    expect(report.invalidCount).toBe(0)
    expect(report.mismatchedTotalCount).toBe(0)
  })

  it('uses the STORED total, not one recomputed from the lines', () => {
    // A real discrepancy: the lines say ฿55, the order says ฿90 was paid.
    const order = makeOrder({ lines: [croissant], total: 9000, payment: cash(9000, 0) })

    const report = buildZReport([order], day)

    expect(report.total).toBe(9000)
    expect(report.cashTotal).toBe(9000)
    // …and the discrepancy is reported rather than hidden.
    expect(report.mismatchedTotalCount).toBe(1)
    expect(report.products).toEqual([
      { productId: 'p-croissant', name: 'Croissant', units: 1, revenue: 5500 },
    ])
  })

  it('is all zeroes for a day with no orders', () => {
    const report = buildZReport([], day)

    expect(report).toEqual({
      dayKey: '2026-01-15',
      orderCount: 0,
      total: 0,
      cashTotal: 0,
      promptPayTotal: 0,
      products: [],
      voidedCount: 0,
      voidedTotal: 0,
      invalidCount: 0,
      mismatchedTotalCount: 0,
    })
  })
})

describe('buildZReport — voids', () => {
  it('counts voided orders but keeps them out of every total', () => {
    const orders = [
      makeOrder({ lines: [croissant], payment: cash(5500, 0) }),
      makeOrder({
        lines: [{ ...baguette, qty: 2 }],
        status: 'voided',
        voidReason: 'Wrong item',
        voidedAt: day.toISOString(),
        payment: cash(12000, 0),
      }),
    ]

    const report = buildZReport(orders, day)

    expect(report.orderCount).toBe(1)
    expect(report.total).toBe(5500)
    expect(report.cashTotal).toBe(5500)
    expect(report.voidedCount).toBe(1)
    expect(report.voidedTotal).toBe(12000)
    // A voided order's items are not sold items.
    expect(report.products.map((p) => p.productId)).toEqual(['p-croissant'])
  })

  it('reports a day of nothing but voids as zero takings, not as an empty day', () => {
    const report = buildZReport(
      [
        makeOrder({
          status: 'voided',
          voidReason: 'Cancelled',
          voidedAt: day.toISOString(),
        }),
      ],
      day,
    )

    expect(report.orderCount).toBe(0)
    expect(report.total).toBe(0)
    expect(report.voidedCount).toBe(1)
    expect(report.voidedTotal).toBe(5500)
  })
})

describe('buildZReport — per product', () => {
  it('accumulates units and revenue across orders from the snapshot prices', () => {
    const orders = [
      makeOrder({ lines: [{ ...croissant, qty: 2 }, baguette] }),
      makeOrder({ lines: [{ ...croissant, qty: 1 }] }),
    ]

    const report = buildZReport(orders, day)

    expect(report.products).toEqual([
      { productId: 'p-croissant', name: 'Croissant', units: 3, revenue: 16500 },
      { productId: 'p-baguette', name: 'Baguette', units: 1, revenue: 6000 },
    ])
  })

  it('keeps each line at its own snapshot price, not the latest one', () => {
    const orders = [
      makeOrder({ lines: [{ ...croissant, unitPrice: 5000, qty: 1 }] }),
      makeOrder({ lines: [{ ...croissant, unitPrice: 6000, qty: 1 }] }),
    ]

    const report = buildZReport(orders, day)

    // 5000 + 6000, never 2 x either price.
    expect(report.products).toEqual([
      { productId: 'p-croissant', name: 'Croissant', units: 2, revenue: 11000 },
    ])
  })

  it('keeps the first snapshot name when a product was renamed mid-day', () => {
    const orders = [
      makeOrder({ lines: [{ ...croissant, name: 'Croissant' }] }),
      makeOrder({ lines: [{ ...croissant, name: 'Butter Croissant' }] }),
    ]

    expect(buildZReport(orders, day).products[0].name).toBe('Croissant')
  })

  it('sorts by revenue, busiest first', () => {
    const orders = [
      makeOrder({ lines: [baguette] }),
      makeOrder({ lines: [{ ...croissant, qty: 3 }] }),
    ]

    expect(buildZReport(orders, day).products.map((p) => p.productId)).toEqual([
      'p-croissant',
      'p-baguette',
    ])
  })
})

describe('buildZReport — day boundaries in local time', () => {
  const justBeforeMidnight = new Date(new Date(2026, 0, 16, 0, 0, 0, 0).getTime() - 1)

  it('includes local midnight, excludes the next local midnight', () => {
    const orders = [
      makeOrder({ id: 'o-start', createdAt: new Date(2026, 0, 15, 0, 0, 0, 0).toISOString() }),
      makeOrder({ id: 'o-late', createdAt: justBeforeMidnight.toISOString() }),
      makeOrder({ id: 'o-yesterday', createdAt: new Date(2026, 0, 14, 23, 59).toISOString() }),
      makeOrder({ id: 'o-tomorrow', createdAt: new Date(2026, 0, 16, 0, 0, 0, 0).toISOString() }),
    ]

    const report = buildZReport(orders, day)

    expect(report.orderCount).toBe(2)
    expect(report.total).toBe(11000)
  })

  it('re-filters by the parsed instant, so an out-of-day order handed in anyway is excluded', () => {
    // `ordersForDay` selects by string comparison on the createdAt index;
    // this is the belt-and-braces check that the takings can only contain
    // orders whose instant really falls inside the day.
    const orders = [makeOrder({ createdAt: new Date(2026, 0, 14, 10, 0).toISOString() })]

    const report = buildZReport(orders, day)

    expect(report.orderCount).toBe(0)
    expect(report.total).toBe(0)
    expect(report.invalidCount).toBe(0)
  })

  it('uses the local day of whatever instant `day` is, not its UTC date', () => {
    const order = makeOrder({ createdAt: justBeforeMidnight.toISOString() })

    // Both are the same local day; both must include the 23:59:59.999 order.
    expect(buildZReport([order], new Date(2026, 0, 15, 0, 0)).orderCount).toBe(1)
    expect(buildZReport([order], justBeforeMidnight).orderCount).toBe(1)
    expect(buildZReport([order], new Date(2026, 0, 16, 0, 0)).orderCount).toBe(0)
  })
})

describe('buildZReport — corrupt data never throws', () => {
  it('skips and counts records that are not orders at all', () => {
    const good = makeOrder({ lines: [croissant] })
    const junk: unknown[] = [
      null,
      undefined,
      10n,
      'an order',
      42,
      [],
      {},
      Symbol('order'),
      () => {},
    ]

    let report!: ReturnType<typeof buildZReport>
    expect(() => {
      report = buildZReport([...junk, good], day)
    }).not.toThrow()

    expect(report.invalidCount).toBe(junk.length)
    expect(report.orderCount).toBe(1)
    expect(report.total).toBe(5500)
  })

  it('skips orders with a corrupt header without losing the good ones', () => {
    const good = makeOrder({ lines: [croissant] })
    const bad = [
      { ...makeOrder(), total: Number.NaN },
      { ...makeOrder(), total: -1 },
      { ...makeOrder(), total: 1e18 },
      { ...makeOrder(), createdAt: 'not a date' },
      { ...makeOrder(), status: 'refunded' },
      { ...makeOrder(), payment: null },
      { ...makeOrder(), payment: { method: 'cash' } },
      { ...makeOrder(), number: 0 },
      { ...makeOrder(), status: 'voided', voidReason: { why: 'object' } },
    ]

    const report = buildZReport([...bad, good], day)

    expect(report.invalidCount).toBe(bad.length)
    expect(report.orderCount).toBe(1)
    expect(report.total).toBe(5500)
  })

  it('skips corrupt lines, still counts the order, and flags the mismatch', () => {
    const order = makeOrder({
      lines: [croissant, { productId: '', name: '', unitPrice: -1, qty: 0 } as CartLine],
      total: 5500,
    })

    const report = buildZReport([order], day)

    expect(report.orderCount).toBe(1)
    expect(report.total).toBe(5500)
    expect(report.mismatchedTotalCount).toBe(1)
    expect(report.products).toEqual([
      { productId: 'p-croissant', name: 'Croissant', units: 1, revenue: 5500 },
    ])
  })

  it('survives an order whose lines are not an array', () => {
    const order = { ...makeOrder(), lines: 'nope' } as unknown as Order

    const report = buildZReport([order], day)

    expect(report.orderCount).toBe(1)
    expect(report.total).toBe(5500)
    expect(report.mismatchedTotalCount).toBe(1)
    expect(report.products).toEqual([])
  })

  it('never lets the running total stop being exact money', () => {
    const huge = Number.MAX_SAFE_INTEGER - 1
    const orders = [
      makeOrder({ lines: [croissant], total: huge, payment: cash(huge, 0) }),
      makeOrder({ lines: [croissant], total: huge, payment: cash(huge, 0) }),
    ]

    const report = buildZReport(orders, day)

    expect(report.orderCount).toBe(1)
    expect(report.total).toBe(huge)
    expect(Number.isSafeInteger(report.total)).toBe(true)
    expect(report.invalidCount).toBe(1)
  })

  it('never throws for a non-array or an unusable day', () => {
    expect(() => buildZReport(undefined as unknown as unknown[], day)).not.toThrow()
    expect(buildZReport(undefined as unknown as unknown[], day).orderCount).toBe(0)

    const invalidDay = new Date('nonsense')
    expect(() => buildZReport([makeOrder()], invalidDay)).not.toThrow()
    expect(buildZReport([makeOrder()], invalidDay)).toMatchObject({ dayKey: '', orderCount: 0 })
  })
})

describe('formatZReport', () => {
  it('matches the expected text exactly', () => {
    const orders = [
      makeOrder({
        lines: [{ ...croissant, qty: 2 }, baguette],
        payment: cash(20000, 3000),
        total: 17000,
      }),
      makeOrder({ lines: [croissant], payment: promptpay(day), total: 5500 }),
      makeOrder({
        lines: [baguette],
        payment: cash(6000, 0),
        total: 6000,
        status: 'voided',
        voidReason: 'Wrong item',
        voidedAt: day.toISOString(),
      }),
    ]

    const text = formatZReport(buildZReport(orders, day), 'Sunrise Bakery')

    expect(text).toBe(
      [
        'Sunrise Bakery — Z report',
        '2026-01-15',
        '',
        'Orders: 2',
        'Total: ฿225',
        'Cash: ฿170',
        'PromptPay: ฿55',
        'Cash expected in drawer: ฿170',
        '',
        'Items',
        'Croissant × 3 — ฿165',
        'Baguette × 1 — ฿60',
        '',
        'Voided: 1 — ฿60 (excluded)',
      ].join('\n'),
    )
  })

  it('says so when there is nothing to report', () => {
    expect(formatZReport(buildZReport([], day), 'Bakery')).toBe(
      [
        'Bakery — Z report',
        '2026-01-15',
        '',
        'Orders: 0',
        'Total: ฿0',
        'Cash: ฿0',
        'PromptPay: ฿0',
        'Cash expected in drawer: ฿0',
        '',
        'Items',
        'None',
      ].join('\n'),
    )
  })

  it('mentions unreadable and mismatched orders only when there are some', () => {
    const report = buildZReport(
      [null, makeOrder({ lines: [croissant], total: 9000, payment: cash(9000, 0) })],
      day,
    )

    const text = formatZReport(report, 'Bakery')

    expect(text).toContain("Orders that couldn't be read: 1")
    expect(text).toContain('Orders with an incomplete item list: 1')
    expect(formatZReport(buildZReport([], day), 'Bakery')).not.toContain("couldn't be read")
  })

  it('shows satang totals to the satang', () => {
    const order = makeOrder({
      lines: [{ productId: 'p-odd', name: 'Odd', unitPrice: 5, qty: 1 }],
      payment: cash(5, 0),
    })

    expect(formatZReport(buildZReport([order], day), 'Bakery')).toContain('Total: ฿0.05')
  })
})
