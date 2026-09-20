import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { completeOrder } from '../db/orders'
import type { CartLine, Payment } from '../domain/types'
import { useVoidOrder } from './useVoidOrder'

let database: PosDatabase

const lines: CartLine[] = [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }]
const exactCash: Payment = { method: 'cash', tendered: 11000, change: 0 }

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useVoidOrder', () => {
  it('voids the order and returns pending to false on success (the screen stays mounted)', async () => {
    const order = await completeOrder(lines, exactCash, database)
    const { result } = renderHook(() => useVoidOrder(database))

    act(() => result.current.voidOrder(order.id, 'Customer changed their mind'))
    expect(result.current.pending).toBe(true)

    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.error).toBeNull()

    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('voided')
    expect(stored?.voidReason).toBe('Customer changed their mind')
  })

  it('a double tap in the same turn voids exactly once', async () => {
    const order = await completeOrder(lines, exactCash, database)
    const { result } = renderHook(() => useVoidOrder(database))

    act(() => {
      result.current.voidOrder(order.id, 'first reason')
      result.current.voidOrder(order.id, 'second reason')
    })

    await waitFor(() => expect(result.current.pending).toBe(false))
    const stored = await database.orders.get(order.id)
    expect(stored?.voidReason).toBe('first reason')
  })

  it('under StrictMode, repeated taps still void exactly once', async () => {
    const order = await completeOrder(lines, exactCash, database)
    const { result } = renderHook(() => useVoidOrder(database), { wrapper: StrictMode })

    act(() => result.current.voidOrder(order.id, 'reason'))
    act(() => result.current.voidOrder(order.id, 'reason'))

    await waitFor(() => expect(result.current.pending).toBe(false))
    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('voided')
  })

  it('a failed void logs, shows an error, re-enables, and a retry voids the order', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useVoidOrder(database))

    act(() => result.current.voidOrder('does-not-exist', 'reason'))
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.error).toMatch(/couldn't void/i)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('not found'))

    const order = await completeOrder(lines, exactCash, database)
    act(() => result.current.voidOrder(order.id, 'reason'))
    expect(result.current.error).toBeNull()

    await waitFor(() => expect(result.current.pending).toBe(false))
    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('voided')
  })

  it('leaves the order completed when the void rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const order = await completeOrder(lines, exactCash, database)
    const { result } = renderHook(() => useVoidOrder(database))

    act(() => result.current.voidOrder('unknown-id', 'reason'))
    await waitFor(() => expect(result.current.error).not.toBeNull())

    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('completed')
  })
})
