import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ORDER_TOAST_MS } from '../domain/orderMessage'
import type { Order } from '../domain/types'
import { OrderToast } from './OrderToast'

const order: Order = {
  id: 'o-1',
  number: 3,
  lines: [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
  total: 5500,
  payment: { method: 'cash', tendered: 10000, change: 4500 },
  status: 'completed',
  createdAt: '2026-09-19T08:00:00.000Z',
  sync: 'pending',
}

afterEach(() => {
  vi.useRealTimers()
})

describe('OrderToast', () => {
  it('shows the order message and dismisses when tapped', () => {
    const onDismiss = vi.fn()
    render(<OrderToast order={order} onDismiss={onDismiss} />)

    const toast = screen.getByRole('button', { name: 'Order #3 — change ฿45' })
    fireEvent.click(toast)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('dismisses itself after ORDER_TOAST_MS, not before', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    render(<OrderToast order={order} onDismiss={onDismiss} />)

    act(() => vi.advanceTimersByTime(ORDER_TOAST_MS - 1))
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('restarts the timer for a new order', () => {
    vi.useFakeTimers()
    const onDismiss = vi.fn()
    const { rerender } = render(<OrderToast order={order} onDismiss={onDismiss} />)

    act(() => vi.advanceTimersByTime(ORDER_TOAST_MS - 100))
    rerender(<OrderToast order={{ ...order, id: 'o-2', number: 4 }} onDismiss={onDismiss} />)
    act(() => vi.advanceTimersByTime(ORDER_TOAST_MS - 100))
    expect(onDismiss).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(100))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
