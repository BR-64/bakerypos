import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { completeOrder } from '../db/orders'
import type { Order } from '../domain/types'
import { OrdersScreen } from './OrdersScreen'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const croissant = { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }

function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: `o-${Math.random()}`,
    number: 1,
    lines: [croissant],
    total: 5500,
    payment: { method: 'cash', tendered: 5500, change: 0 },
    status: 'completed',
    createdAt: new Date().toISOString(),
    sync: 'pending',
    ...overrides,
  }
}

describe('OrdersScreen', () => {
  it('shows "No orders yet today." when there are none', async () => {
    render(<OrdersScreen database={database} />)
    expect(await screen.findByText('No orders yet today.')).toBeInTheDocument()
  })

  it("lists today's orders with number, time, total and method", async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    await completeOrder(
      [croissant],
      { method: 'promptpay', confirmedAt: new Date().toISOString() },
      database,
    )

    render(<OrdersScreen database={database} />)

    const row1 = await screen.findByRole('button', { name: /#1/ })
    expect(row1).toHaveTextContent('฿55')
    expect(row1).toHaveTextContent('Cash')

    const row2 = screen.getByRole('button', { name: /#2/ })
    expect(row2).toHaveTextContent('PromptPay')
  })

  it('shows a "Voided" badge on a voided order', async () => {
    await database.orders.add(
      makeOrder({ id: 'o-voided', number: 1, status: 'voided', voidReason: 'test' }),
    )

    render(<OrdersScreen database={database} />)

    const row = await screen.findByRole('button', { name: /#1/ })
    expect(row).toHaveTextContent('Voided')
  })

  it("excludes yesterday's orders", async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await database.orders.add(makeOrder({ id: 'o-yesterday', createdAt: yesterday.toISOString() }))
    await database.orders.add(makeOrder({ id: 'o-today', number: 2 }))

    render(<OrdersScreen database={database} />)

    await screen.findByRole('button', { name: /#2/ })
    expect(screen.queryByRole('button', { name: /#1/ })).not.toBeInTheDocument()
  })

  it('skips a corrupt order, logs it once, and shows a count in the footer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.orders.add(makeOrder({ id: 'o-good', number: 1 }))
    // total: NaN makes this fail isValidOrder's header check.
    await database.orders.add(makeOrder({ id: 'o-bad', number: 2, total: NaN }))

    render(<OrdersScreen database={database} />)

    await screen.findByRole('button', { name: /#1/ })
    expect(screen.queryByRole('button', { name: /#2/ })).not.toBeInTheDocument()
    expect(await screen.findByText("1 order couldn't be displayed.")).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalledTimes(1)
  })

  it('never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called')
    })
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)

    render(<OrdersScreen database={database} />)
    await screen.findByRole('button', { name: /#1/ })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('recovers via "Try again" after a rejected query', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const flakyDatabase = {
      orders: {
        where: () => ({
          between: () => ({
            toArray: () => {
              calls++
              return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve([])
            },
          }),
        }),
      },
    } as unknown as PosDatabase

    render(<OrdersScreen database={flakyDatabase} />)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('No orders yet today.')).toBeInTheDocument()
  })
})
