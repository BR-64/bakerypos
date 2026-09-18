import { act, renderHook } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import * as cartModule from '../domain/cart'
import type { CartLine, Product } from '../domain/types'
import { useCart } from './useCart'

// Restores every spy/mock after each test, so a failing test's
// `console.error` spy (or similar) can never leak into a later test.
afterEach(() => {
  vi.restoreAllMocks()
})

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

const croissantLine: CartLine = {
  productId: 'p-croissant',
  name: 'Croissant',
  unitPrice: 5500,
  qty: 2,
}

describe('useCart', () => {
  it('starts empty', () => {
    const { result } = renderHook(() => useCart())
    expect(result.current.lines).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.count).toBe(0)
  })

  it('adding the same product twice in one act bumps qty to 2', () => {
    const { result } = renderHook(() => useCart())
    act(() => {
      result.current.add(croissant)
      result.current.add(croissant)
    })
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
    expect(result.current.count).toBe(2)
    expect(result.current.total).toBe(11000)
  })

  it('increment bumps qty and updates total/count', () => {
    const { result } = renderHook(() => useCart())
    act(() => result.current.add(croissant))
    act(() => result.current.increment('p-croissant'))
    expect(result.current.lines[0].qty).toBe(2)
    expect(result.current.count).toBe(2)
    expect(result.current.total).toBe(11000)
  })

  it('decrementing to zero removes the line', () => {
    const { result } = renderHook(() => useCart())
    act(() => result.current.add(croissant))
    act(() => result.current.decrement('p-croissant'))
    expect(result.current.lines).toEqual([])
    expect(result.current.count).toBe(0)
    expect(result.current.total).toBe(0)
  })

  it('remove drops a line regardless of qty', () => {
    const { result } = renderHook(() => useCart())
    act(() => {
      result.current.add(croissant)
      result.current.increment('p-croissant')
    })
    act(() => result.current.remove('p-croissant'))
    expect(result.current.lines).toEqual([])
    expect(result.current.count).toBe(0)
  })

  it('clear empties the cart', () => {
    const { result } = renderHook(() => useCart())
    act(() => {
      result.current.add(croissant)
      result.current.add(cookie)
    })
    act(() => result.current.clear())
    expect(result.current.lines).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.count).toBe(0)
  })

  it('add leaves lines unchanged (same reference) when the product would create a new line with a non-integer price, and the hook still works afterwards', () => {
    const { result } = renderHook(() => useCart())
    const before = result.current.lines

    act(() => result.current.add({ ...croissant, price: 55.5 }))

    // addProduct skips invalid data by returning `lines` unchanged rather
    // than throwing, so useCart.add's own try/catch never even fires here
    // — nothing is logged for this expected, non-exceptional case.
    expect(result.current.lines).toBe(before)
    expect(result.current.lines).toEqual([])

    act(() => result.current.add(croissant))
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])
  })

  it('the try/catch in add is a last-resort guard: an unexpected throw from addProduct is caught and logged, never crashes', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(cartModule, 'addProduct').mockImplementation(() => {
      throw new Error('unexpected bug')
    })
    const { result } = renderHook(() => useCart())
    const before = result.current.lines

    expect(() => act(() => result.current.add(croissant))).not.toThrow()

    expect(result.current.lines).toBe(before)
    expect(errorSpy).toHaveBeenCalled()
  })

  it('re-adding an existing line bumps qty at the original snapshot price even after the product is repriced to a non-integer', () => {
    const { result } = renderHook(() => useCart())
    act(() => result.current.add(croissant))
    act(() => result.current.add({ ...croissant, price: 55.5 }))

    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
    expect(result.current.total).toBe(11000)
  })

  it('never throws when add/remove/add are batched in one act and a stale ref would otherwise be wrong', () => {
    const { result } = renderHook(() => useCart())

    expect(() => {
      act(() => {
        result.current.add(croissant)
        result.current.remove('p-croissant')
        result.current.add({ ...croissant, price: 55.5 })
      })
    }).not.toThrow()

    expect(result.current.lines).toEqual([])
  })

  it('regression: 20 rapid add() calls in one act give an exact count and total', () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      for (let i = 0; i < 20; i++) result.current.add(croissant)
    })

    expect(result.current.count).toBe(20)
    expect(result.current.total).toBe(5500 * 20)
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 20 },
    ])
  })

  it('regression: interleaved add() calls on two products give exact per-line qty', () => {
    const { result } = renderHook(() => useCart())

    act(() => {
      result.current.add(croissant)
      result.current.add(cookie)
      result.current.add(croissant)
      result.current.add(croissant)
      result.current.add(cookie)
    })

    expect(result.current.lines).toEqual(
      expect.arrayContaining([
        { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 3 },
        { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 2 },
      ]),
    )
    expect(result.current.count).toBe(5)
    expect(result.current.total).toBe(5500 * 3 + 4000 * 2)
  })

  it('regression: repricing or renaming a product already in the cart keeps its snapshot and still bumps qty to 2', () => {
    const { result } = renderHook(() => useCart())
    act(() => result.current.add(croissant))

    act(() => result.current.add({ ...croissant, price: 6000, name: 'New Name' }))

    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
    expect(result.current.total).toBe(11000)
  })

  it('regression: archiving or going out of stock for a product already in the cart never bumps its line', () => {
    const { result } = renderHook(() => useCart())
    act(() => result.current.add(croissant))
    const before = result.current.lines

    act(() => result.current.add({ ...croissant, archived: true }))
    expect(result.current.lines).toBe(before)
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])

    act(() => result.current.add({ ...croissant, outOfStock: true }))
    expect(result.current.lines).toBe(before)
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])

    expect(result.current.count).toBe(1)
    expect(result.current.total).toBe(5500)
  })

  it('a no-op action (incrementing an unknown productId) keeps lines the same reference', () => {
    const { result } = renderHook(() => useCart())
    act(() => result.current.add(croissant))
    const before = result.current.lines

    act(() => result.current.increment('unknown-product'))
    expect(result.current.lines).toBe(before)
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])
  })

  it('with one invalid line present, lines stays the same reference across a rerender (the memo is stable)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const corrupt: CartLine = { productId: '', name: 'Bad', unitPrice: 100, qty: 1 }
    const { result, rerender } = renderHook(() => useCart([croissantLine, corrupt]))
    const before = result.current.lines

    rerender()
    expect(result.current.lines).toBe(before)
  })

  it('keeps action identities stable across rerenders', () => {
    const { result, rerender } = renderHook(() => useCart())
    const first = {
      add: result.current.add,
      increment: result.current.increment,
      decrement: result.current.decrement,
      remove: result.current.remove,
      clear: result.current.clear,
    }
    act(() => result.current.add(croissant))
    rerender()
    expect(result.current.add).toBe(first.add)
    expect(result.current.increment).toBe(first.increment)
    expect(result.current.decrement).toBe(first.decrement)
    expect(result.current.remove).toBe(first.remove)
    expect(result.current.clear).toBe(first.clear)
  })
})

describe('useCart with corrupt initial lines', () => {
  const validLine: CartLine = {
    productId: 'p-croissant',
    name: 'Croissant',
    unitPrice: 5500,
    qty: 2,
  }
  const corruptLines: CartLine[] = [
    // empty productId
    { productId: '', name: 'Bad Id', unitPrice: 100, qty: 1 },
    // blank name
    { productId: 'p-blank', name: '   ', unitPrice: 100, qty: 1 },
    // negative unitPrice
    { productId: 'p-neg', name: 'Negative', unitPrice: -50, qty: 1 },
  ]

  it('exposes only the valid line, and total/count exclude the corrupt ones', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useCart([validLine, ...corruptLines]))

    expect(result.current.lines).toEqual([validLine])
    expect(result.current.total).toBe(11000)
    expect(result.current.count).toBe(2)
  })

  it('logs each corrupt line exactly once, across rerenders and actions', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result, rerender } = renderHook(() => useCart([validLine, ...corruptLines]))

    expect(errorSpy).toHaveBeenCalledTimes(3)

    rerender()
    act(() => result.current.increment('p-croissant'))
    rerender()
    act(() => result.current.decrement('p-croissant'))

    expect(errorSpy).toHaveBeenCalledTimes(3)
  })

  it('increment, decrement and clear still work with corrupt lines present', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useCart([validLine, ...corruptLines]))

    act(() => result.current.increment('p-croissant'))
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 3 },
    ])

    act(() => result.current.decrement('p-croissant'))
    expect(result.current.lines).toEqual([validLine])

    act(() => result.current.clear())
    expect(result.current.lines).toEqual([])
    expect(result.current.total).toBe(0)
    expect(result.current.count).toBe(0)
  })
})

describe('useCart actions operate on valid, de-duplicated lines only (fix round 1)', () => {
  it('a hidden invalid same-id line is never resurrected or cross-mutated by "+"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Before the fix, domain `increment` maps over *every* line matching
    // productId, so this raw qty:0 line (invalid — qty must be >= 1) would
    // get bumped to qty:1 (becoming "valid") right alongside the real
    // qty:3 line bumping to qty:4 — total jumps to 5*5500=27500 (฿275)
    // instead of the correct 4*5500=22000 (฿220).
    const zeroQtyLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 0,
    }
    const threeQtyLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 3,
    }

    const { result } = renderHook(() => useCart([zeroQtyLine, threeQtyLine]))
    expect(result.current.total).toBe(16500)

    act(() => result.current.increment('p-croissant'))

    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 4 },
    ])
    expect(result.current.total).toBe(22000)
  })

  it('a hidden invalid same-id line is never used to wipe out the real line via "-"', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    // Before the fix, domain `decrement` does `lines.find(...)`, which
    // matches this raw qty:0 line first (it's invalid, but decrement
    // doesn't know that), sees qty <= 1, and filters out *every* line with
    // that productId — deleting the real qty:3 line as collateral damage.
    const zeroQtyLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 0,
    }
    const threeQtyLine: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant',
      unitPrice: 5500,
      qty: 3,
    }

    const { result } = renderHook(() => useCart([zeroQtyLine, threeQtyLine]))

    act(() => result.current.decrement('p-croissant'))

    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 },
    ])
  })

  it.each([
    ['null', null],
    ['a bare number', 42],
    [
      'a circular object (also invalid: no productId)',
      (() => {
        const circular: Record<string, unknown> = { name: 'Circular', unitPrice: 100, qty: 1 }
        circular.self = circular
        return circular
      })(),
    ],
    ['a line with a BigInt field', { productId: 'p-big', name: 'Big', unitPrice: 100, qty: 10n }],
  ])(
    'a raw line that is %s never crashes + or -, and the good line still steps correctly',
    (_label, badRaw) => {
      vi.spyOn(console, 'error').mockImplementation(() => {})
      const { result } = renderHook(() => useCart([croissantLine, badRaw as unknown as CartLine]))

      expect(result.current.lines).toEqual([croissantLine])

      expect(() => act(() => result.current.increment('p-croissant'))).not.toThrow()
      expect(result.current.lines).toEqual([{ ...croissantLine, qty: 3 }])

      expect(() => act(() => result.current.decrement('p-croissant'))).not.toThrow()
      expect(result.current.lines).toEqual([croissantLine])
    },
  )

  it('a string qty ("2") line is invalid and stays out of lines through + and - (no coercion resurrection)', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const stringQtyLine = {
      productId: 'p-bad-qty',
      name: 'Bad Qty',
      unitPrice: 100,
      qty: '2',
    } as unknown as CartLine

    const { result } = renderHook(() => useCart([croissantLine, stringQtyLine]))
    expect(result.current.lines).toEqual([croissantLine])

    act(() => result.current.increment('p-bad-qty'))
    expect(result.current.lines.find((l) => l.productId === 'p-bad-qty')).toBeUndefined()
    expect(result.current.lines).toEqual([croissantLine])

    act(() => result.current.decrement('p-bad-qty'))
    expect(result.current.lines.find((l) => l.productId === 'p-bad-qty')).toBeUndefined()
    expect(result.current.lines).toEqual([croissantLine])
  })

  it('two valid lines sharing a productId: only the first is exposed, and "+" bumps only that one', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const duplicate: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant (dup)',
      unitPrice: 6000,
      qty: 5,
    }

    const { result } = renderHook(() => useCart([croissantLine, duplicate]))
    expect(result.current.lines).toEqual([croissantLine])
    expect(errorSpy).toHaveBeenCalledTimes(1)

    act(() => result.current.increment('p-croissant'))
    expect(result.current.lines).toEqual([{ ...croissantLine, qty: 3 }])
  })
})

describe('useCart total overflow guard', () => {
  it('an overflowing second line is hidden (not a ฿0 fallback): only the first line is exposed, total is exact, and the second logs exactly once even under StrictMode, with no extra log on rerender or a "+" tap on the first line', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const hugeLineA: CartLine = {
      productId: 'p-huge-a',
      name: 'Huge A',
      unitPrice: Number.MAX_SAFE_INTEGER,
      qty: 1,
    }
    const hugeLineB: CartLine = {
      productId: 'p-huge-b',
      name: 'Huge B',
      unitPrice: Number.MAX_SAFE_INTEGER,
      qty: 1,
    }

    const { result, rerender } = renderHook(() => useCart([hugeLineA, hugeLineB]), {
      wrapper: StrictMode,
    })

    // Only the first line is kept — the second would push the running
    // total past Number.MAX_SAFE_INTEGER, so partitionCartLines treats it
    // as invalid, exactly like a duplicate productId.
    expect(result.current.lines).toEqual([hugeLineA])
    expect(result.current.total).toBe(Number.MAX_SAFE_INTEGER)

    const logsForSecond = () =>
      errorSpy.mock.calls.filter(
        (args) => typeof args[0] === 'string' && args[0].includes('p-huge-b'),
      ).length
    expect(logsForSecond()).toBe(1)

    rerender()
    expect(logsForSecond()).toBe(1)

    // Bumping the first line would itself overflow (2 * MAX_SAFE_INTEGER),
    // so increment (N2) is a no-op — no new invalid line, no new log.
    act(() => result.current.increment('p-huge-a'))
    expect(result.current.lines).toEqual([hugeLineA])
    expect(logsForSecond()).toBe(1)
  })
})
