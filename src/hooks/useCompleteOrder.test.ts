import { act, renderHook, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import type { CartLine, Payment } from '../domain/types'
import { useCompleteOrder } from './useCompleteOrder'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const lines: CartLine[] = [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }]
const exactCash: Payment = { method: 'cash', tendered: 11000, change: 0 }

describe('useCompleteOrder', () => {
  it('stores the order and calls onOrderComplete once with it', async () => {
    const onOrderComplete = vi.fn()
    const { result } = renderHook(() => useCompleteOrder(lines, database, onOrderComplete))

    act(() => result.current.complete(exactCash))
    expect(result.current.pending).toBe(true)

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [stored] = await database.orders.toArray()
    expect(onOrderComplete).toHaveBeenCalledWith(stored)
    expect(stored).toMatchObject({ total: 11000, payment: exactCash })
    // App leaves the screen on success, so it stays disabled.
    expect(result.current.pending).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('a double tap in the same turn creates exactly one order', async () => {
    const onOrderComplete = vi.fn()
    const { result } = renderHook(() => useCompleteOrder(lines, database, onOrderComplete))

    act(() => {
      result.current.complete(exactCash)
      result.current.complete({ method: 'cash', tendered: 50000, change: 39000 })
    })

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
    expect((await database.orders.toArray())[0].payment).toEqual(exactCash)
  })

  it('under StrictMode, repeated taps still create exactly one order', async () => {
    const onOrderComplete = vi.fn()
    const { result } = renderHook(() => useCompleteOrder(lines, database, onOrderComplete), {
      wrapper: StrictMode,
    })

    act(() => result.current.complete(exactCash))
    act(() => result.current.complete(exactCash))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('a failed save logs, shows an error, re-enables, and a retry stores exactly one order', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onOrderComplete = vi.fn()
    ;(
      vi.spyOn(database, 'transaction') as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useCompleteOrder(lines, database, onOrderComplete))

    act(() => result.current.complete(exactCash))
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(result.current.error).toMatch(/couldn't save/i)
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('disk full'))
    expect(onOrderComplete).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)

    act(() => result.current.complete(exactCash))
    expect(result.current.error).toBeNull()
    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('a payment completeOrder rejects (cash that does not balance) never stores or completes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onOrderComplete = vi.fn()
    const { result } = renderHook(() => useCompleteOrder(lines, database, onOrderComplete))

    act(() => result.current.complete({ method: 'cash', tendered: 5000, change: 0 }))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(onOrderComplete).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)
  })

  it('still calls onOrderComplete if the screen unmounts before the save finishes', async () => {
    const onOrderComplete = vi.fn()
    const { result, unmount } = renderHook(() => useCompleteOrder(lines, database, onOrderComplete))

    act(() => result.current.complete(exactCash))
    unmount()

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })
})
