import { describe, expect, it } from 'vitest'
import {
  backupFileName,
  buildExport,
  buildOrdersCsv,
  ordersCsvFileName,
  parseImport,
  validateBackup,
  BACKUP_FORMAT,
  BACKUP_FORMAT_VERSION,
  MAX_IMPORT_CHARS,
  type BackupInput,
  type BackupPayload,
} from './backup'
import { parseBahtInput } from './money'
import { buildZReport } from './report'
import { DEFAULT_SETTINGS, type Settings } from './settings'
import type { Order, OrderLine, Product } from './types'

/** Local midnight of the day every fixture below sits on. */
const DAY = new Date(2026, 8, 20)

/** A canonical ISO instant at a local wall-clock time on `DAY`. */
function at(hour: number, minute = 0): string {
  const when = new Date(DAY)
  when.setHours(hour, minute, 0, 0)
  return when.toISOString()
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

const sourdough: Product = {
  id: 'p-sourdough',
  name: 'Sourdough',
  price: 12000,
  category: 'bread',
  sortOrder: 2,
  outOfStock: true,
  archived: true,
}

function line(overrides: Partial<OrderLine> = {}): OrderLine {
  return { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2, ...overrides }
}

function order(overrides: Partial<Order> = {}): Order {
  const lines = overrides.lines ?? [line()]
  return {
    id: 'o-1',
    number: 1,
    lines,
    total: lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0),
    payment: { method: 'cash', tendered: 20000, change: 9000 },
    status: 'completed',
    createdAt: at(9, 5),
    sync: 'pending',
    ...overrides,
  }
}

const settings: Settings = {
  ...DEFAULT_SETTINGS,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
  pinHash: 'a'.repeat(64),
  pinSalt: 'c'.repeat(32),
  recoveryHash: 'b'.repeat(64),
  lockedUntil: 1_800_000_000_000,
}

function exported(input: Partial<Parameters<typeof buildExport>[0]> = {}): BackupPayload {
  return buildExport(
    { products: [croissant], orders: [order()], settings, ...input },
    new Date(2026, 8, 20, 17, 30),
  )
}

/** The round trip the whole feature rests on: write the file, read it back. */
function roundTrip(payload: BackupPayload): BackupPayload {
  const result = parseImport(JSON.stringify(payload, null, 2))
  if (!result.ok) throw new Error(`expected a valid payload, got: ${result.error}`)
  return result.payload
}

describe('buildExport', () => {
  it('carries every product and order through unchanged, as integer satang', () => {
    const payload = exported({ products: [croissant, sourdough], orders: [order()] })

    expect(payload.products).toEqual([croissant, sourdough])
    expect(payload.orders).toEqual([order()])
    // Money in the JSON is satang, never baht: 5500, not 55 and not "55.00".
    expect(payload.orders[0].lines[0].unitPrice).toBe(5500)
    expect(payload.orders[0].total).toBe(11000)
    expect(payload.products[0].price).toBe(5500)
  })

  it('stamps the format, the version and the local export day', () => {
    const payload = exported()

    expect(payload.format).toBe(BACKUP_FORMAT)
    expect(payload.version).toBe(BACKUP_FORMAT_VERSION)
    expect(payload.exportedAt).toBe(new Date(2026, 8, 20, 17, 30).toISOString())
    // Local day, not a UTC slice of the instant above.
    expect(payload.dayKey).toBe('2026-09-20')
  })

  it('never lets the PIN fields into the file', () => {
    const payload = exported()

    expect(payload.settings).toEqual({
      shopName: 'Sunrise Bakery',
      promptPayId: '0812345678',
      categoryOrder: DEFAULT_SETTINGS.categoryOrder,
    })
    // Not just absent from the object — absent from the bytes.
    const json = JSON.stringify(payload)
    for (const field of ['pinHash', 'pinSalt', 'recoveryHash', 'lockedUntil']) {
      expect(json).not.toContain(field)
    }
    expect(json).not.toContain('a'.repeat(64))
    expect(json).not.toContain('c'.repeat(32))
  })

  it('leaves out records that could not be imported again, so the file is always readable', () => {
    const payload = exported({
      products: [croissant, { ...croissant, id: 'p-bad', price: 12.5 }],
      orders: [order(), order({ id: 'o-bad', total: 999 })],
    })

    expect(payload.products.map((p) => p.id)).toEqual(['p-croissant'])
    expect(payload.orders.map((o) => o.id)).toEqual(['o-1'])
    expect(parseImport(JSON.stringify(payload)).ok).toBe(true)
  })

  it('keeps the first of two records that share an id', () => {
    const payload = exported({
      products: [croissant, { ...croissant, name: 'Impostor' }],
      orders: [order(), order({ number: 9 })],
    })

    expect(payload.products).toEqual([croissant])
    expect(payload.orders[0].number).toBe(1)
  })

  it('repairs corrupt settings instead of refusing to export', () => {
    const payload = exported({ settings: { shopName: 42, promptPayId: '0812345678' } })

    expect(payload.settings.shopName).toBe(DEFAULT_SETTINGS.shopName)
    expect(payload.settings.promptPayId).toBe('0812345678')
  })

  it('never throws on junk input', () => {
    const junk = { products: null, orders: 'nope', settings: undefined } as unknown as BackupInput
    expect(() => buildExport(junk)).not.toThrow()
    expect(buildExport(junk).orders).toEqual([])
    expect(buildExport({ products: [], orders: [], settings: null }).orders).toEqual([])
  })
})

describe('the file names', () => {
  it('date the files by the local day', () => {
    // 00:30 local on the 20th is still the 19th in UTC — a `toISOString`
    // slice would date both files a day early.
    const earlyMorning = new Date(2026, 8, 20, 0, 30)
    expect(backupFileName(earlyMorning)).toBe('bakery-pos-2026-09-20.json')
    expect(ordersCsvFileName(earlyMorning)).toBe('orders-2026-09-20.csv')
  })
})

describe('export → import', () => {
  it('reproduces every product and order exactly', () => {
    const orders = [
      order(),
      order({
        id: 'o-2',
        number: 2,
        payment: { method: 'promptpay', confirmedAt: at(11, 0) },
        createdAt: at(11, 0),
        lines: [
          line({ qty: 1 }),
          line({ productId: 'p-sourdough', name: 'Sourdough', unitPrice: 12000, qty: 3 }),
        ],
      }),
      order({
        id: 'o-3',
        number: 3,
        status: 'voided',
        voidedAt: at(12, 0),
        voidReason: 'Wrong item',
        createdAt: at(11, 55),
        sync: 'synced',
      }),
    ]
    const payload = exported({ products: [croissant, sourdough], orders })

    const reread = roundTrip(payload)

    expect(reread.products).toEqual([croissant, sourdough])
    expect(reread.orders).toEqual(orders)
    expect(reread.settings).toEqual(payload.settings)
  })

  it('does not invent an undefined voidedAt/voidReason on a completed order', () => {
    const reread = roundTrip(exported())

    expect(Object.keys(reread.orders[0]).sort()).toEqual(
      ['createdAt', 'id', 'lines', 'number', 'payment', 'status', 'sync', 'total'].sort(),
    )
  })
})

describe('parseImport — what it refuses', () => {
  const cases: [string, unknown, string][] = [
    ['nothing', '', 'empty'],
    ['whitespace', '   \n', 'empty'],
    ['a non-string', { format: BACKUP_FORMAT }, 'empty'],
    ['junk', 'not json at all', 'not-json'],
    ['truncated JSON', '{"format":"bakery-pos-backup","products":[', 'not-json'],
    ['a JSON array', '[]', 'not-a-backup'],
    ['a JSON string', '"hello"', 'not-a-backup'],
    ['null', 'null', 'not-a-backup'],
    ['someone else’s JSON', '{"orders":[]}', 'not-a-backup'],
  ]

  for (const [what, input, reason] of cases) {
    it(`refuses ${what}`, () => {
      const result = parseImport(input)
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe(reason)
        expect(result.error.length).toBeGreaterThan(0)
      }
    })
  }

  it('refuses a format version it does not know', () => {
    const result = parseImport(JSON.stringify({ ...exported(), version: 2 }))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toBe('unsupported-version')
      expect(result.error).toContain('version 2')
    }
  })

  it('refuses a file that is too big to read, before trying to parse it', () => {
    const result = parseImport('x'.repeat(MAX_IMPORT_CHARS + 1))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('too-large')
  })

  it('refuses a missing or non-list product/order collection', () => {
    expect(parseImport(JSON.stringify({ ...exported(), products: null }))).toMatchObject({
      reason: 'bad-products',
    })
    expect(parseImport(JSON.stringify({ ...exported(), orders: {} }))).toMatchObject({
      reason: 'bad-orders',
    })
  })

  const badProducts: [string, unknown][] = [
    ['not an object', 42],
    ['null', null],
    ['missing an id', { ...croissant, id: '' }],
    ['missing a name', { ...croissant, name: '   ' }],
    ['a fractional price', { ...croissant, price: 55.5 }],
    ['a price beyond safe integers', { ...croissant, price: 1e18 }],
    ['a negative price', { ...croissant, price: -1 }],
    ['an unknown category', { ...croissant, category: 'sandwich' }],
    ['a corrupt sold-out flag', { ...croissant, outOfStock: 'false' }],
    ['no sort position', { ...croissant, sortOrder: Number.NaN }],
  ]

  for (const [what, product] of badProducts) {
    it(`refuses the whole file for a product that is ${what}`, () => {
      const result = parseImport(JSON.stringify({ ...exported(), products: [croissant, product] }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('bad-products')
        // The message points at the record, so the owner can go and fix it.
        expect(result.error).toContain('Product 2')
      }
    })
  }

  const badOrders: [string, unknown][] = [
    ['not an object', 'an order'],
    ['missing an id', { ...order(), id: '' }],
    ['numbered zero', { ...order(), number: 0 }],
    ['a fractional total', { ...order(), total: 110.5 }],
    ['a total beyond safe integers', { ...order(), total: 1e18 }],
    ['a total that does not match its lines', { ...order(), total: 11001 }],
    ['an unknown status', { ...order(), status: 'refunded' }],
    ['voided with no reason', { ...order(), status: 'voided' }],
    ['a payment with no method', { ...order(), payment: { tendered: 20000 } }],
    [
      'cash that is not whole satang',
      { ...order(), payment: { method: 'cash', tendered: 200.5, change: 0 } },
    ],
    ['no lines at all', { ...order(), lines: [], total: 0 }],
    ['lines that are not a list', { ...order(), lines: 'two croissants' }],
    ['a line with no name', { ...order(), lines: [line({ name: '' })] }],
    ['a line with a fractional qty', { ...order(), lines: [line({ qty: 1.5 })] }],
    ['a duplicated line product', { ...order(), lines: [line(), line()], total: 22000 }],
    ['an unparseable timestamp', { ...order(), createdAt: 'yesterday' }],
    ['a non-UTC timestamp', { ...order(), createdAt: '2026-09-20T07:00:01.000+07:00' }],
    ['an unknown sync state', { ...order(), sync: 'maybe' }],
  ]

  for (const [what, corrupt] of badOrders) {
    it(`refuses the whole file for an order with ${what}`, () => {
      const result = parseImport(JSON.stringify({ ...exported(), orders: [order(), corrupt] }))
      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.reason).toBe('bad-orders')
        expect(result.error).toContain('Order 2')
      }
    })
  }

  it('refuses a file that lists the same id twice', () => {
    expect(
      parseImport(JSON.stringify({ ...exported(), products: [croissant, croissant] })),
    ).toMatchObject({ reason: 'bad-products' })
    expect(
      parseImport(JSON.stringify({ ...exported(), orders: [order(), order()] })),
    ).toMatchObject({ reason: 'bad-orders' })
  })

  it('never throws, whatever it is handed', () => {
    const nasty: unknown[] = [
      undefined,
      null,
      42,
      Symbol('x'),
      '{"format":"bakery-pos-backup","version":1,"products":[],"orders":[],"settings":{}}'.slice(
        0,
        30,
      ),
      '{"a":1e999}',
      `{"format":"${BACKUP_FORMAT}","version":1,"products":[],"orders":[],"settings":"nope"}`,
    ]
    for (const input of nasty) {
      expect(() => parseImport(input)).not.toThrow()
    }
  })
})

describe('parseImport — what it strips', () => {
  it('drops __proto__ and friends before anything looks at the object', () => {
    // Spliced into the text rather than built with an object literal:
    // `{ __proto__: x }` in a literal sets the prototype, so it would
    // never reach `JSON.stringify` at all — but a hand-edited *file* can
    // carry the key for real.
    const polluted = '"__proto__":{"polluted":true},"constructor":{"polluted":true},'
    const text = JSON.stringify(exported())
      .replace('{"format"', `{${polluted}"format"`)
      .replace('"products":[{', `"products":[{${polluted}`)
    expect(text).toContain('__proto__')

    const result = parseImport(text)

    expect(result.ok).toBe(true)
    expect(({} as Record<string, unknown>).polluted).toBeUndefined()
    if (result.ok) {
      expect(result.payload.products[0]).toEqual(croissant)
      expect(Object.hasOwn(result.payload.products[0], 'polluted')).toBe(false)
    }
  })

  it('drops PIN fields a hand-edited file tries to smuggle back in', () => {
    const text = JSON.stringify({
      ...exported(),
      settings: {
        shopName: 'Sunrise Bakery',
        promptPayId: '0812345678',
        categoryOrder: DEFAULT_SETTINGS.categoryOrder,
        pinHash: 'd'.repeat(64),
        pinSalt: 'e'.repeat(32),
        recoveryHash: 'f'.repeat(64),
        lockedUntil: 99,
      },
    })

    const result = parseImport(text)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(Object.keys(result.payload.settings).sort()).toEqual([
        'categoryOrder',
        'promptPayId',
        'shopName',
      ])
    }
  })

  it('keeps fields the app does not know out of the records it hands back', () => {
    const text = JSON.stringify({
      ...exported(),
      orders: [{ ...order(), somethingElse: 'ignore me' }],
    })

    const result = parseImport(text)

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.payload.orders[0]).toEqual(order())
  })

  it('repairs corrupt settings rather than refusing the orders', () => {
    const result = parseImport(JSON.stringify({ ...exported(), settings: { shopName: '' } }))

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.settings.shopName).toBe(DEFAULT_SETTINGS.shopName)
      expect(result.payload.settings.promptPayId).toBe(DEFAULT_SETTINGS.promptPayId)
    }
  })
})

describe('validateBackup', () => {
  it('refuses an already-parsed payload with a corrupt order', () => {
    const payload = { ...exported(), orders: [{ ...order(), total: 1 }] }
    const result = validateBackup(payload)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('bad-orders')
  })
})

describe('buildOrdersCsv', () => {
  function rows(csv: string): string[] {
    expect(csv.endsWith('\r\n')).toBe(true)
    return csv.trimEnd().split('\r\n')
  }

  it('writes one row per order line, with the header first', () => {
    const csv = buildOrdersCsv(
      [
        order({
          lines: [
            line({ qty: 2 }),
            line({ productId: 'p-sourdough', name: 'Sourdough', unitPrice: 12000, qty: 1 }),
          ],
          createdAt: at(14, 5),
        }),
      ],
      DAY,
    )

    expect(rows(csv)).toEqual([
      'Order,Time,Product,Qty,Unit price (baht),Line total (baht),Payment,Status',
      '1,14:05,Croissant,2,55.00,110.00,cash,completed',
      '1,14:05,Sourdough,1,120.00,120.00,cash,completed',
    ])
  })

  it('writes money as two-decimal baht, never satang and never a float', () => {
    const csv = buildOrdersCsv(
      [order({ lines: [line({ unitPrice: 4550, qty: 3 })], total: 13650 })],
      DAY,
    )

    expect(rows(csv)[1]).toContain('45.50,136.50')
  })

  it('quotes and escapes a product name with a comma or a quote in it', () => {
    const csv = buildOrdersCsv(
      [
        order({
          lines: [line({ name: 'Cake, large' }), line({ productId: 'p-2', name: 'The "Big" Bun' })],
          total: 22000,
        }),
      ],
      DAY,
    )

    const body = rows(csv).slice(1)
    expect(body[0]).toContain('"Cake, large"')
    expect(body[1]).toContain('"The ""Big"" Bun"')
  })

  it('defuses a product name a spreadsheet would treat as a formula', () => {
    const csv = buildOrdersCsv([order({ lines: [line({ name: '=1+1' })], total: 11000 })], DAY)

    expect(rows(csv)[1]).toContain("'=1+1")
  })

  it('includes voided orders, marked as such', () => {
    const csv = buildOrdersCsv(
      [order({ status: 'voided', voidReason: 'Wrong item', voidedAt: at(15, 0) })],
      DAY,
    )

    expect(rows(csv)[1]).toContain(',voided')
  })

  it('covers only the chosen local day, and sorts oldest first', () => {
    const yesterday = new Date(2026, 8, 19, 10, 0)
    const csv = buildOrdersCsv(
      [
        order({ id: 'o-late', number: 3, createdAt: at(16, 0) }),
        order({ id: 'o-yesterday', number: 1, createdAt: yesterday.toISOString() }),
        order({ id: 'o-early', number: 2, createdAt: at(8, 0) }),
      ],
      DAY,
    )

    expect(
      rows(csv)
        .slice(1)
        .map((row) => row.split(',')[1]),
    ).toEqual(['08:00', '16:00'])
  })

  it('skips unreadable records instead of throwing', () => {
    const csv = buildOrdersCsv([null, 'nope', { total: 1 }, order()], DAY)

    expect(rows(csv)).toHaveLength(2)
    expect(() => buildOrdersCsv(undefined as unknown as unknown[], DAY)).not.toThrow()
  })
})

describe('the CSV and the Z report', () => {
  /** Satang totals per payment method, read back out of the CSV. */
  function csvTotals(csv: string): { total: number; cash: number; promptpay: number } {
    const totals = { total: 0, cash: 0, promptpay: 0 }
    for (const row of csv.trimEnd().split('\r\n').slice(1)) {
      const [, , , , , lineTotalBaht, payment, status] = row.split(',')
      if (status !== 'completed') continue
      const satang = parseBahtInput(lineTotalBaht)
      expect(satang).not.toBeNull()
      totals.total += satang ?? 0
      if (payment === 'cash') totals.cash += satang ?? 0
      else totals.promptpay += satang ?? 0
    }
    return totals
  }

  it('agree on the day’s takings, by method', () => {
    const orders = [
      order({ id: 'o-1', number: 1, createdAt: at(8, 30), lines: [line({ qty: 2 })] }),
      order({
        id: 'o-2',
        number: 2,
        createdAt: at(10, 15),
        payment: { method: 'promptpay', confirmedAt: at(10, 15) },
        lines: [
          line({ qty: 1 }),
          line({ productId: 'p-sourdough', name: 'Sourdough', unitPrice: 12000, qty: 2 }),
        ],
      }),
      order({
        id: 'o-3',
        number: 3,
        createdAt: at(12, 0),
        lines: [line({ unitPrice: 4550, qty: 3 })],
      }),
      // Voided: in the CSV as a row, in neither report total.
      order({
        id: 'o-4',
        number: 4,
        createdAt: at(13, 0),
        status: 'voided',
        voidReason: 'Wrong item',
        voidedAt: at(13, 5),
      }),
      // Yesterday: in neither.
      order({ id: 'o-5', number: 5, createdAt: new Date(2026, 8, 19, 9, 0).toISOString() }),
    ]

    const report = buildZReport(orders, DAY)
    const totals = csvTotals(buildOrdersCsv(orders, DAY))

    expect(report.orderCount).toBe(3)
    expect(totals.total).toBe(report.total)
    expect(totals.cash).toBe(report.cashTotal)
    expect(totals.promptpay).toBe(report.promptPayTotal)
  })

  it('agree that an empty day is empty', () => {
    const report = buildZReport([], DAY)
    const totals = csvTotals(buildOrdersCsv([], DAY))

    expect(totals.total).toBe(report.total)
    expect(report.total).toBe(0)
  })
})
