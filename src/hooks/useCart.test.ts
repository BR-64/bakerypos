import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
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
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useCart())
    const before = result.current.lines

    act(() => result.current.add({ ...croissant, price: 55.5 }))

    expect(result.current.lines).toBe(before)
    expect(result.current.lines).toEqual([])
    expect(errorSpy).toHaveBeenCalled()

    act(() => result.current.add(croissant))
    expect(result.current.lines).toEqual([
      { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 },
    ])

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
