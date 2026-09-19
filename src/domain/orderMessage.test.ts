import { describe, expect, it } from 'vitest'
import { orderCompleteMessage } from './orderMessage'
import type { Order } from './types'

const base: Order = {
  id: 'o-1',
  number: 12,
  lines: [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
  total: 5500,
  payment: { method: 'cash', tendered: 10000, change: 4500 },
  status: 'completed',
  createdAt: '2026-09-19T08:00:00.000Z',
  sync: 'pending',
}

describe('orderCompleteMessage', () => {
  it('shows the order number and change for a cash order', () => {
    expect(orderCompleteMessage(base)).toBe('Order #12 — change ฿45')
  })

  it('shows satang in the change when there is any', () => {
    const order: Order = { ...base, payment: { method: 'cash', tendered: 10000, change: 4550 } }
    expect(orderCompleteMessage(order)).toBe('Order #12 — change ฿45.50')
  })

  it('shows change ฿0 for exact cash', () => {
    const order: Order = { ...base, payment: { method: 'cash', tendered: 5500, change: 0 } }
    expect(orderCompleteMessage(order)).toBe('Order #12 — change ฿0')
  })

  it('shows "paid" for a PromptPay order', () => {
    const order: Order = {
      ...base,
      number: 13,
      payment: { method: 'promptpay', confirmedAt: '2026-09-19T08:01:00.000Z' },
    }
    expect(orderCompleteMessage(order)).toBe('Order #13 — paid')
  })
})
