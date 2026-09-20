import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import { TAP_SHIELD_MS } from './hooks/useTapShield'

// App-level tests for the post-sale tap shield (task 6). Uses a cash sale
// (task 4's screen) purely as the simplest way to trigger `onOrderComplete`;
// the shield itself lives in App, not in any checkout screen.

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()

  // Fake only setTimeout/clearTimeout: this makes the shield's own timer
  // (and OrderToast's) controllable via vi.advanceTimersByTime, while
  // leaving everything else on real scheduling —
  // - Testing Library's waitFor/findBy* poll via a real setInterval (this
  //   project has no `jest` global, so their fake-timer auto-detection is
  //   never triggered), so they keep working unmodified;
  // - `shouldAdvanceTime: true` ties the fake clock to real elapsed time
  //   too, so Dexie's own internal `setTimeout(fn, 0)` scheduling (see
  //   node_modules/dexie/dist/dexie.js) still resolves promptly instead of
  //   hanging forever waiting for a manual advance that never comes.
  // A plain vi.useFakeTimers() additionally fakes things like
  // performance.now/queueMicrotask-adjacent APIs and can hang Dexie outright.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

async function completeACashSale() {
  fireEvent.click(await screen.findByRole('button', { name: /Croissant/ }))
  await waitFor(() => {
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
  })
  fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
  await screen.findByRole('heading', { name: 'Cart' })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
  await screen.findByRole('heading', { name: 'Cash' })
  fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
  await waitFor(() => {
    expect(screen.getByRole('status')).toHaveTextContent('Order #1')
  })
}

describe('App — tap shield', () => {
  it('blocks a tile tap right after a sale, then lets the same tap through once TAP_SHIELD_MS has passed', async () => {
    render(<App database={database} />)
    await completeACashSale()

    // Back on Sell with an empty cart; the shield was just raised. The
    // screen just remounted (App keys each screen's ErrorBoundary by
    // `${screen}:${retryKey}`), so its product grid is querying again —
    // `findByRole` waits that out; the shield's own state is unaffected by
    // how much *real* time this takes, since only the fake clock, advanced
    // explicitly below, controls it.
    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')

    // Still comfortably inside the shield window (a wide margin below
    // TAP_SHIELD_MS, since `shouldAdvanceTime` also ticks the fake clock
    // forward with real elapsed time — the razor-edge 399ms/400ms boundary
    // is covered precisely, with no such drift, by useTapShield.test.ts).
    act(() => {
      vi.advanceTimersByTime(TAP_SHIELD_MS - 100)
    })
    fireEvent.click(croissantTile)
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')

    // Now comfortably past it.
    act(() => {
      vi.advanceTimersByTime(200)
    })
    fireEvent.click(croissantTile)
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
  })

  it('the order toast stays tappable, and still dismisses on tap, while the shield is up', async () => {
    render(<App database={database} />)
    await completeACashSale()

    const toast = screen.getByRole('button', { name: /Order #1/ })
    fireEvent.click(toast)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('the bottom nav stays usable, and still navigates, while the shield is up', async () => {
    render(<App database={database} />)
    await completeACashSale()

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))
    expect(screen.getByRole('heading', { name: 'Orders' })).toBeInTheDocument()
  })

  it('never calls fetch on the way to a shielded sale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<App database={database} />)
    await completeACashSale()

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
