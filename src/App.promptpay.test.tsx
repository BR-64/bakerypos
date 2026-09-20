import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import { TAP_SHIELD_MS } from './hooks/useTapShield'

// App-level tests for the PromptPay checkout path, now built around the real
// PromptPayScreen (task 5). Task 4's equivalent lives in App.cash.test.tsx
// and must not edit this file (see the comment in App.tsx's screen registry).

// The real QRCodeSVG renders plain SVG (no canvas), so it's fine under
// jsdom, but these tests don't care about the QR itself — this mock just
// keeps them from rendering (and depending on) an actual QR code.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: () => <svg data-testid="promptpay-qr" />,
}))

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
  // Only the "second consecutive PromptPay sale" test below enables fake
  // timers; restoring real ones unconditionally here is a no-op otherwise
  // and keeps that test from ever leaking fake timers into the next one.
  vi.useRealTimers()
})

async function addCroissantAndOpenPromptPay() {
  fireEvent.click(await screen.findByRole('button', { name: /Croissant/ }))
  await waitFor(() => {
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
  })
  fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
  await screen.findByRole('heading', { name: 'Cart' })
  fireEvent.click(screen.getByRole('button', { name: 'PromptPay' }))
  await screen.findByRole('heading', { name: 'PromptPay' })
}

describe('App — PromptPay checkout', () => {
  it('goes Sell -> Cart -> PromptPay -> Cancel (to Cart) -> Back to Sell with the cart intact', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenPromptPay()

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await screen.findByRole('heading', { name: 'Cart' })
    fireEvent.click(screen.getByRole('button', { name: 'Back to Sell' }))

    await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    expect(await database.orders.count()).toBe(0)
  })

  it('a completed PromptPay sale clears the cart, returns to Sell and shows "Order #N — paid"', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenPromptPay()

    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))

    // The status region is always mounted, so wait for its text, not the region.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1 — paid')
    })
    const bar = await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')
    expect(bar).toBeDisabled()

    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({ number: 1, total: 5500, payment: { method: 'promptpay' } })

    fireEvent.click(screen.getByRole('button', { name: 'Order #1 — paid' }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('a second consecutive PromptPay sale shows "Order #2 — paid" with 2 orders stored', async () => {
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
    await addCroissantAndOpenPromptPay()
    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1 — paid')
    })

    act(() => {
      vi.advanceTimersByTime(TAP_SHIELD_MS)
    })

    await addCroissantAndOpenPromptPay()
    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #2 — paid')
    })

    expect(await database.orders.count()).toBe(2)
  })

  it('never calls fetch on the way to a completed PromptPay sale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<App database={database} />)
    await addCroissantAndOpenPromptPay()
    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
