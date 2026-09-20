import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { completeOrder } from '../db/orders'
import { saveSettings } from '../db/settings'
import { generateSalt, hashPin, MAX_PIN_ATTEMPTS } from '../domain/pin'
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings'
import type { Order } from '../domain/types'
import type { PinLock } from '../hooks/usePinLock'
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

function stubLock(overrides: Partial<PinLock> = {}): PinLock {
  return {
    unlocked: true,
    lockoutMsLeft: 0,
    attemptsLeft: MAX_PIN_ATTEMPTS,
    unlock: vi.fn(),
    lock: vi.fn(),
    registerFailure: vi.fn(),
    ...overrides,
  }
}

/**
 * The screen with the PIN already unlocked, which is the state every test
 * below except the "void is behind the PIN" ones cares about: browsing
 * orders never asks for a PIN, and these tests are about the list, the
 * detail and voiding itself.
 */
function Orders({ database, lock = stubLock() }: { database: PosDatabase; lock?: PinLock }) {
  return <OrdersScreen database={database} pinLock={lock} settings={DEFAULT_SETTINGS} />
}

describe('OrdersScreen', () => {
  it('shows "No orders yet today." when there are none', async () => {
    render(<Orders database={database} />)
    expect(await screen.findByText('No orders yet today.')).toBeInTheDocument()
  })

  it("lists today's orders with number, time, total and method", async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    await completeOrder(
      [croissant],
      { method: 'promptpay', confirmedAt: new Date().toISOString() },
      database,
    )

    render(<Orders database={database} />)

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

    render(<Orders database={database} />)

    const row = await screen.findByRole('button', { name: /#1/ })
    expect(row).toHaveTextContent('Voided')
  })

  it("excludes yesterday's orders", async () => {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    await database.orders.add(makeOrder({ id: 'o-yesterday', createdAt: yesterday.toISOString() }))
    await database.orders.add(makeOrder({ id: 'o-today', number: 2 }))

    render(<Orders database={database} />)

    await screen.findByRole('button', { name: /#2/ })
    expect(screen.queryByRole('button', { name: /#1/ })).not.toBeInTheDocument()
  })

  it('skips a corrupt order, logs it once, and shows a count in the footer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.orders.add(makeOrder({ id: 'o-good', number: 1 }))
    // total: NaN makes this fail isValidOrder's header check.
    await database.orders.add(makeOrder({ id: 'o-bad', number: 2, total: NaN }))

    render(<Orders database={database} />)

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

    render(<Orders database={database} />)
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

    render(<Orders database={flakyDatabase} />)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByText('No orders yet today.')).toBeInTheDocument()
  })
})

describe('OrdersScreen — detail and void', () => {
  it('tapping a row opens the detail with snapshot lines, stored total and cash tendered/change', async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 10000, change: 4500 }, database)

    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))

    expect(await screen.findByRole('heading', { name: /Order #1/ })).toBeInTheDocument()
    expect(screen.getByText('Croissant × 1')).toBeInTheDocument()
    expect(screen.getByText('Total ฿55')).toBeInTheDocument()
    expect(screen.getByText(/tendered ฿100/)).toBeInTheDocument()
    expect(screen.getByText(/change ฿45/)).toBeInTheDocument()
  })

  it('Back returns to the list', async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })

    fireEvent.click(screen.getByRole('button', { name: 'Back' }))

    expect(await screen.findByRole('button', { name: /#1/ })).toBeInTheDocument()
  })

  it('"Yes, void" is disabled until a reason is picked, then voids and live-updates the detail', async () => {
    const order = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 5500, change: 0 },
      database,
    )
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })

    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    const yesVoid = screen.getByRole('button', { name: 'Yes, void' })
    expect(yesVoid).toBeDisabled()

    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order' }))
    expect(yesVoid).not.toBeDisabled()

    fireEvent.click(yesVoid)

    await waitFor(() => {
      expect(screen.getByText(/Void reason: Duplicate order/)).toBeInTheDocument()
    })
    expect(screen.queryByRole('button', { name: 'Void this order' })).not.toBeInTheDocument()
    expect(screen.getAllByText('Voided').length).toBeGreaterThan(0)

    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('voided')
    expect(stored?.voidReason).toBe('Duplicate order')
    expect(stored?.voidedAt).toBeTruthy()
  })

  it('"Other…" requires typed text before "Yes, void" enables', async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })

    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Other' }))
    const yesVoid = screen.getByRole('button', { name: 'Yes, void' })
    expect(yesVoid).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Void reason'), { target: { value: '  Stale item  ' } })
    expect(yesVoid).not.toBeDisabled()

    fireEvent.click(yesVoid)
    await waitFor(() => {
      expect(screen.getByText('Void reason: Stale item')).toBeInTheDocument()
    })
  })

  it('"Keep order" cancels without voiding', async () => {
    const order = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 5500, change: 0 },
      database,
    )
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })

    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }))

    expect(screen.getByRole('button', { name: 'Void this order' })).toBeInTheDocument()
    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('completed')
  })

  it('a StrictMode double tap on "Yes, void" voids exactly once', async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    render(
      <StrictMode>
        <Orders database={database} />
      </StrictMode>,
    )
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })
    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order' }))

    const yesVoid = screen.getByRole('button', { name: 'Yes, void' })
    fireEvent.click(yesVoid)
    fireEvent.click(yesVoid)

    await waitFor(() => {
      expect(screen.getByText(/Void reason: Duplicate order/)).toBeInTheDocument()
    })
    expect(await database.orders.count()).toBe(1)
  })

  it('a rejected void shows a role="alert" and leaves the order completed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const order = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 5500, change: 0 },
      database,
    )
    const updateSpy = vi
      .spyOn(database.orders, 'update')
      .mockRejectedValueOnce(new Error('disk full'))

    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })
    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't void/i)
    const stored = await database.orders.get(order.id)
    expect(stored?.status).toBe('completed')
    updateSpy.mockRestore()
  })

  it('a voided order shows the badge and reason instead of a Void button', async () => {
    await database.orders.add(
      makeOrder({
        id: 'o-voided',
        number: 1,
        status: 'voided',
        voidReason: 'already voided',
      }),
    )
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))

    expect(await screen.findByText('Void reason: already voided')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Void this order' })).not.toBeInTheDocument()
  })

  it('skips a corrupt line in the detail, logs it once, counts it, and still allows voiding', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.orders.add(
      makeOrder({
        id: 'o-1',
        number: 1,
        lines: [croissant, { productId: '', name: '', unitPrice: -1, qty: 0 }],
      }),
    )
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))

    expect(await screen.findByText('Croissant × 1')).toBeInTheDocument()
    expect(screen.getByText("1 item couldn't be displayed.")).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    expect(screen.getByRole('button', { name: 'Yes, void' })).toBeInTheDocument()
  })

  it('shows a message, and never auto-navigates, if the open order becomes unavailable', async () => {
    await database.orders.add(makeOrder({ id: 'o-1', number: 1 }))
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })

    // Corrupt the order in place (an unknown status fails isValidOrder's
    // header check), simulating it rolling out of "today" or otherwise
    // becoming invalid while its detail is open.
    await database.orders.update('o-1', { status: 'refunded' } as unknown as Partial<Order>)

    expect(await screen.findByText('This order is no longer available.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByText('No orders yet today.')).toBeInTheDocument()
  })

  it('a voided order with a non-string voidReason is skipped from the list, logged once, and counted in the footer (never crashes)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.orders.add(makeOrder({ id: 'o-good', number: 1 }))
    await database.orders.add(
      makeOrder({
        id: 'o-bad',
        number: 2,
        status: 'voided',
        // @ts-expect-error deliberately corrupt voidReason for the test
        voidReason: { note: 'not a string' },
      }),
    )

    render(<Orders database={database} />)

    expect(await screen.findByRole('button', { name: /#1/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /#2/ })).not.toBeInTheDocument()
    expect(await screen.findByText("1 order couldn't be displayed.")).toBeInTheDocument()
    expect(errorSpy).toHaveBeenCalled()
  })

  it('"Try again" resets the open detail back to the list, so a still-crashing order does not loop forever', async () => {
    // Forces the detail (specifically) to throw via a mock, standing in for
    // "some unforeseen crash cause `isValidOrder` doesn't yet check for" —
    // the one *known* cause (a non-string voidReason) is now caught by
    // `isValidOrder` itself (see the test above), so this exercises the
    // retry-reset as a defense-in-depth measure independent of that fix.
    // `lineTotal` is only ever called from the detail's line list, never
    // from a list row, which is what makes this test meaningful: if "Try
    // again" merely remounted the boundary without also clearing
    // `selectedId`, it would try to re-render the same detail and crash
    // again identically — indistinguishable from success unless the retry
    // actually lands somewhere that doesn't call `lineTotal` at all.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.orders.add(makeOrder({ id: 'o-1', number: 1 }))
    const moneyModule = await import('../domain/money')
    const lineTotalSpy = vi.spyOn(moneyModule, 'lineTotal').mockImplementation(() => {
      throw new Error('boom (test)')
    })

    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    // Back at the list (never another crash) — proof `selectedId` was
    // cleared, since the mock is still throwing and would crash the detail
    // again immediately if `onRetry` had reopened it.
    expect(await screen.findByRole('button', { name: /^#1/ })).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()

    lineTotalSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it('a stale void-failure alert is cleared once the panel is closed and reopened', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    const updateSpy = vi
      .spyOn(database.orders, 'update')
      .mockRejectedValueOnce(new Error('disk full'))

    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })
    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't void/i)
    updateSpy.mockRestore()

    fireEvent.click(screen.getByRole('button', { name: 'Keep order' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('deleting the order while the void panel is open shows the unavailable message, and does not crash', async () => {
    const order = await completeOrder(
      [croissant],
      { method: 'cash', tendered: 5500, change: 0 },
      database,
    )
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })
    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Duplicate order' }))

    await database.orders.delete(order.id)

    expect(await screen.findByText('This order is no longer available.')).toBeInTheDocument()
  })

  it('shows the stored total even when it disagrees with the sum of the lines', async () => {
    await database.orders.add(makeOrder({ id: 'o-1', number: 1, lines: [croissant], total: 20000 }))
    render(<Orders database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))

    // croissant alone sums to ฿55 — the detail must never recompute this.
    expect(await screen.findByText('Total ฿200')).toBeInTheDocument()
    expect(screen.queryByText('Total ฿55')).not.toBeInTheDocument()
  })
})

describe('OrdersScreen — void behind the PIN', () => {
  async function storedPin(pin: string): Promise<Settings> {
    const pinSalt = generateSalt()
    const pinHash = await hashPin(pin, pinSalt)
    return { ...DEFAULT_SETTINGS, pinHash, pinSalt, recoveryHash: null }
  }

  async function openDetail(): Promise<void> {
    fireEvent.click(await screen.findByRole('button', { name: /#1/ }))
    await screen.findByRole('heading', { name: /Order #1/ })
  }

  it('asks for the PIN before showing the void reasons, and unlocks on the right one', async () => {
    const settings = await storedPin('4821')
    await saveSettings(settings, database)
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    const lock = stubLock({ unlocked: false })
    render(<OrdersScreen database={database} pinLock={lock} settings={settings} />)

    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))

    expect(screen.getByRole('heading', { name: 'Enter the PIN for Void' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate order' })).not.toBeInTheDocument()

    for (const digit of '4821') {
      fireEvent.click(screen.getByRole('button', { name: digit }))
    }
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(lock.unlock).toHaveBeenCalledTimes(1))
    // The order itself is untouched by unlocking.
    expect((await database.orders.get((await database.orders.toArray())[0].id))?.status).toBe(
      'completed',
    )
  })

  it('browsing orders never asks for a PIN, even while locked', async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    render(
      <OrdersScreen
        database={database}
        pinLock={stubLock({ unlocked: false })}
        settings={DEFAULT_SETTINGS}
      />,
    )

    await openDetail()

    expect(screen.getByText('Total ฿55')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
  })

  it('shows the void reasons straight away once the lock is already open', async () => {
    await completeOrder([croissant], { method: 'cash', tendered: 5500, change: 0 }, database)
    render(<Orders database={database} />)

    await openDetail()
    fireEvent.click(screen.getByRole('button', { name: 'Void this order' }))

    expect(screen.getByRole('button', { name: 'Duplicate order' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Unlock' })).not.toBeInTheDocument()
  })
})
