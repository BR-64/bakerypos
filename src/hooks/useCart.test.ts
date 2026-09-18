import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import * as cartModule from '../domain/cart'
import type { Product } from '../domain/types'
import { useCart } from './useCart'

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
    const addProductSpy = vi.spyOn(cartModule, 'addProduct').mockImplementation(() => {
      throw new Error('unexpected bug')
    })
    const { result } = renderHook(() => useCart())
    const before = result.current.lines

    expect(() => act(() => result.current.add(croissant))).not.toThrow()

    expect(result.current.lines).toBe(before)
    expect(errorSpy).toHaveBeenCalled()

    addProductSpy.mockRestore()
    errorSpy.mockRestore()
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
