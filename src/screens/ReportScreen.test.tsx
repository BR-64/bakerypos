import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { localDayKey } from '../domain/day'
import { buildZReport, formatZReport } from '../domain/report'
import { SETTINGS_ID, type Settings } from '../domain/settings'
import type { CartLine, Order, Payment } from '../domain/types'
import { ReportScreen } from './ReportScreen'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
  now = new Date()
  todayKey = localDayKey(at(0, 12))
  yesterdayKey = localDayKey(at(1, 12))
  tomorrowKey = localDayKey(at(-1, 12))
})

// Every navigator stub below is an own property; deleting it leaves the
// object as the next test file finds it.
afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

function installNavigatorApi(name: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true })
}

const settings: Settings = {
  id: SETTINGS_ID,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
}

const croissant: CartLine = { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }
const baguette: CartLine = { productId: 'p-baguette', name: 'Baguette', unitPrice: 6000, qty: 1 }

// Captured per test, never once at import: a run that crosses local
// midnight between module load and the assertions would otherwise compare
// today's rendered date against yesterday's key.
let now: Date
let todayKey: string
let yesterdayKey: string
let tomorrowKey: string

/** A local instant on the day `daysAgo` days back from `now`. */
function at(daysAgo: number, hour: number): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, hour, 0)
}

let nextNumber = 1

function makeOrder(overrides: Partial<Order> & { createdAt: string }): Order {
  const lines = overrides.lines ?? [croissant]
  const total = lines.reduce((sum, l) => sum + l.unitPrice * l.qty, 0)
  const payment: Payment = { method: 'cash', tendered: total, change: 0 }
  return {
    id: `o-${nextNumber}`,
    number: nextNumber++,
    lines,
    total,
    payment,
    status: 'completed',
    sync: 'pending',
    ...overrides,
  }
}

function renderScreen(props: { settings?: Settings | null } = {}) {
  // `'settings' in props`, not `??` — `null` is a meaningful value here
  // ("not loaded yet") and must not fall back to the loaded fixture.
  const value = 'settings' in props ? (props.settings as Settings | null) : settings
  return render(<ReportScreen database={database} settings={value} />)
}

/**
 * The value shown against a summary label. The same amount legitimately
 * appears more than once (Cash and "Cash expected in drawer" are the same
 * figure by definition), so the tests read each row by its own label
 * instead of searching the whole screen for a baht string.
 */
function summaryValue(label: string): string | null {
  for (const row of document.querySelectorAll('.report-summary-row')) {
    if (row.querySelector('dt')?.textContent === label) {
      return row.querySelector('dd')?.textContent ?? null
    }
  }
  return null
}

function productRow(name: string): HTMLElement | null {
  for (const row of document.querySelectorAll<HTMLElement>('.report-product')) {
    if (row.querySelector('.report-product-name')?.textContent === name) return row
  }
  return null
}

describe('ReportScreen', () => {
  it('shows counts, totals, the drawer figure, per-product rows and the voided line', async () => {
    await database.orders.bulkAdd([
      makeOrder({
        createdAt: at(0, 9).toISOString(),
        lines: [{ ...croissant, qty: 2 }],
        total: 11000,
        payment: { method: 'cash', tendered: 20000, change: 9000 },
      }),
      makeOrder({
        createdAt: at(0, 10).toISOString(),
        lines: [baguette],
        total: 6000,
        payment: { method: 'promptpay', confirmedAt: at(0, 10).toISOString() },
      }),
      makeOrder({
        createdAt: at(0, 11).toISOString(),
        lines: [croissant],
        total: 5500,
        status: 'voided',
        voidReason: 'Wrong item',
        voidedAt: at(0, 11).toISOString(),
      }),
    ])

    renderScreen()

    // ฿110 cash + ฿60 PromptPay; the ฿55 void is counted, never totalled.
    await waitFor(() => expect(summaryValue('Total')).toBe('฿170'))
    expect(summaryValue('Orders')).toBe('2')
    expect(summaryValue('Cash')).toBe('฿110')
    expect(summaryValue('PromptPay')).toBe('฿60')
    expect(summaryValue('Cash expected in drawer')).toBe('฿110')
    expect(screen.getByText('Voided: 1 — ฿55 (excluded)')).toBeInTheDocument()

    const croissantRow = productRow('Croissant')
    expect(croissantRow).not.toBeNull()
    // 2 sold, not 3: the voided order's croissant is not a sold item.
    expect(within(croissantRow as HTMLElement).getByText('× 2')).toBeInTheDocument()
    expect(within(croissantRow as HTMLElement).getByText('฿110')).toBeInTheDocument()
    expect(productRow('Baguette')).not.toBeNull()
  })

  it('starts on today and re-queries when the date input changes', async () => {
    await database.orders.bulkAdd([
      makeOrder({ createdAt: at(0, 9).toISOString(), lines: [croissant], total: 5500 }),
      makeOrder({
        createdAt: at(1, 9).toISOString(),
        lines: [{ ...baguette, qty: 3 }],
        total: 18000,
      }),
    ])

    renderScreen()

    const input = screen.getByLabelText('Day') as HTMLInputElement
    expect(input.value).toBe(todayKey)
    await waitFor(() => expect(summaryValue('Total')).toBe('฿55'))
    expect(productRow('Croissant')).not.toBeNull()

    fireEvent.change(input, { target: { value: yesterdayKey } })

    await waitFor(() => expect(summaryValue('Total')).toBe('฿180'))
    expect(productRow('Baguette')).not.toBeNull()
    expect(productRow('Croissant')).toBeNull()
  })

  it('says so for a day with nothing on it', async () => {
    await database.orders.add(
      makeOrder({ createdAt: at(1, 9).toISOString(), lines: [croissant], total: 5500 }),
    )

    renderScreen()

    expect(await screen.findByText('No sales on this day.')).toBeInTheDocument()
  })

  it('never lets today be exceeded on the picker', () => {
    renderScreen()
    expect(screen.getByLabelText('Day')).toHaveAttribute('max', todayKey)
  })

  it('says "Pick a day." — without crashing — when the date input is cleared', async () => {
    await database.orders.add(
      makeOrder({ createdAt: at(0, 9).toISOString(), lines: [croissant], total: 5500 }),
    )

    renderScreen()
    const input = screen.getByLabelText('Day') as HTMLInputElement
    await waitFor(() => expect(summaryValue('Total')).toBe('฿55'))

    // Browsers hand back '' for an emptied date field, which is not a day.
    fireEvent.change(input, { target: { value: '' } })

    expect(await screen.findByText('Pick a day.')).toBeInTheDocument()
    expect(summaryValue('Total')).toBeNull()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()

    // …and picking a real day again recovers.
    fireEvent.change(input, { target: { value: todayKey } })
    await waitFor(() => expect(summaryValue('Total')).toBe('฿55'))
  })

  it('queries cleanly for a day past `max`, which some browsers still allow typing', async () => {
    await database.orders.add(
      makeOrder({ createdAt: at(0, 9).toISOString(), lines: [croissant], total: 5500 }),
    )

    renderScreen()
    const input = screen.getByLabelText('Day') as HTMLInputElement
    await waitFor(() => expect(summaryValue('Total')).toBe('฿55'))

    fireEvent.change(input, { target: { value: tomorrowKey } })

    expect(await screen.findByText('No sales on this day.')).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
  })

  it('keeps the picker usable while the settings read is still in flight, with Share disabled', async () => {
    await database.orders.add(
      makeOrder({ createdAt: at(0, 9).toISOString(), lines: [croissant], total: 5500 }),
    )

    renderScreen({ settings: null })

    await waitFor(() => expect(summaryValue('Total')).toBe('฿55'))
    expect(screen.getByRole('button', { name: 'Share' })).toBeDisabled()
    expect(screen.getByLabelText('Day')).toBeEnabled()
  })
})

describe('ReportScreen — sharing', () => {
  /** One ฿110 cash sale today; resolves with the exact text Share must produce. */
  async function renderWithOneSale(): Promise<string> {
    const order = makeOrder({
      createdAt: at(0, 9).toISOString(),
      lines: [{ ...croissant, qty: 2 }],
      total: 11000,
      payment: { method: 'cash', tendered: 20000, change: 9000 },
    })
    await database.orders.add(order)
    renderScreen()
    await waitFor(() => expect(summaryValue('Total')).toBe('฿110'))
    return formatZReport(buildZReport([order], at(0, 12)), settings.shopName)
  }

  it('copies exactly formatZReport(...) when there is no share sheet', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', { writeText })

    const expected = await renderWithOneSale()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected))
    expect(await screen.findByText('Copied')).toBeInTheDocument()
  })

  it('hands the share sheet exactly formatZReport(...)', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('clipboard', { writeText })

    const expected = await renderWithOneSale()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(share).toHaveBeenCalledWith({ text: expected })
    await waitFor(() => expect(writeText).not.toHaveBeenCalled())
  })

  it('a cancelled share shows no error and never touches the clipboard', async () => {
    const abort = new Error('Share canceled')
    abort.name = 'AbortError'
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', vi.fn().mockRejectedValue(abort))
    installNavigatorApi('clipboard', { writeText })

    await renderWithOneSale()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
    expect(writeText).not.toHaveBeenCalled()
    expect(screen.queryByText('Copied')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Z report text')).not.toBeInTheDocument()
  })

  it('offers a selectable read-only textarea when neither API exists', async () => {
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', undefined)

    const expected = await renderWithOneSale()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    const textarea = (await screen.findByLabelText('Z report text')) as HTMLTextAreaElement
    expect(textarea.value).toBe(expected)
    expect(textarea).toHaveAttribute('readonly')
  })

  it('never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called')
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', { writeText })

    await renderWithOneSale()
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(writeText).toHaveBeenCalled())

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('ReportScreen — bad data', () => {
  it('skips corrupt orders, counts them, and still shows the good ones', async () => {
    await database.orders.bulkAdd([
      makeOrder({ createdAt: at(0, 9).toISOString(), lines: [croissant], total: 5500 }),
      { ...makeOrder({ createdAt: at(0, 10).toISOString() }), total: Number.NaN } as Order,
    ])

    renderScreen()

    await waitFor(() => expect(summaryValue('Total')).toBe('฿55'))
    expect(screen.getByText("1 order couldn't be read.")).toBeInTheDocument()
  })

  it('shows a handled message rather than crashing when the query rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.orders, 'where').mockImplementation(() => {
      throw new Error('IndexedDB is gone')
    })

    renderScreen()

    // The inner boundary catches it; the day picker outside the boundary
    // is still there to escape with.
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByLabelText('Day')).toBeInTheDocument()
  })
})
