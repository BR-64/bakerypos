import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import { TAP_SHIELD_MS } from './hooks/useTapShield'

// App-level tests for the Cash checkout path, wired to the real CashScreen
// (task 5's PromptPay path has its own file, App.promptpay.test.tsx, which
// this file must not touch).

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Only the "second sale" test below enables fake timers; restoring real
  // ones unconditionally here is a no-op otherwise and keeps that test from
  // ever leaking fake timers into whichever test runs next.
  vi.useRealTimers()
})

async function addBrownieAndOpenCash() {
  fireEvent.click(await screen.findByRole('button', { name: /Brownie 9 cubes/ }))
  await waitFor(() => {
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿300')
  })
  fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
  await screen.findByRole('heading', { name: 'Cart' })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
  await screen.findByRole('heading', { name: 'Cash' })
}

describe('App — Cash checkout', () => {
  it('goes Sell -> Cart -> Cash -> Back to Cart with the cart intact', async () => {
    render(<App database={database} />)
    await addBrownieAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }))

    await screen.findByRole('heading', { name: 'Cart' })
    expect(document.querySelector('.cart-bottom-bar-total')?.textContent).toBe('Total ฿300')
    expect(await database.orders.count()).toBe(0)
  })

  it('goes Sell -> Cart -> Cash -> Exact -> Sell with the toast and an empty cart', async () => {
    render(<App database={database} />)
    await addBrownieAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿300' }))

    // The status region is always mounted, so wait for its text, not the region.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1 — change ฿0')
    })
    const bar = await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')
    expect(bar).toBeDisabled()

    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      number: 1,
      total: 30000,
      payment: { method: 'cash', tendered: 30000, change: 0 },
    })

    // Tapping the confirmation dismisses it.
    fireEvent.click(screen.getByRole('button', { name: 'Order #1 — change ฿0' }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('goes Sell -> Cart -> Cash -> ฿500 -> Sell with the correct change for a ฿300 cart', async () => {
    render(<App database={database} />)
    await addBrownieAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: '฿500' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1 — change ฿200')
    })
    const bar = await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')
    expect(bar).toBeDisabled()

    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      number: 1,
      total: 30000,
      payment: { method: 'cash', tendered: 50000, change: 20000 },
    })
  })

  it('a second sale replaces the previous confirmation', async () => {
    // Task 6's tap shield (src/hooks/useTapShield.ts) briefly blocks taps
    // right after a sale so a stray tap from the same gesture can't start a
    // new one — see src/App.shield.test.tsx, which documents this exact
    // fake-timer setup (`shouldAdvanceTime: true` keeps Dexie's own
    // internal `setTimeout(fn, 0)` scheduling resolving). On a real phone,
    // the time a cashier takes to add the next item dwarfs the shield's
    // window; here the two sales happen back-to-back, so this fast-forwards
    // past it instead of a real 400ms sleep. Fake timers must be enabled
    // before the first sale completes — the shield's own timer is created
    // then, and only a fake one is something `advanceTimersByTime` controls.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })

    render(<App database={database} />)
    await addBrownieAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿300' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    act(() => {
      vi.advanceTimersByTime(TAP_SHIELD_MS)
    })

    await addBrownieAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿300' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #2 — change ฿0')
    })
    expect(screen.getByRole('status')).not.toHaveTextContent('Order #1')
    expect(await database.orders.count()).toBe(2)
  })

  it('never calls fetch on the way to a completed cash sale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<App database={database} />)
    await addBrownieAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿300' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
