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
  //   (A pure `vi.advanceTimersByTimeAsync(0)`-pumping approach — no real
  //   time at all — was tried instead of `shouldAdvanceTime`, but
  //   `todaysOrders`'s ranged cursor query over fake-indexeddb needs more
  //   real event-loop turns than any bounded number of pumps reliably
  //   supplies, and hung. `shouldAdvanceTime` is the practical tradeoff.)
  //
  // Because the fake clock is real-time-linked, real wall-clock time *does*
  // leak into the shield's own timer between `raise()` and an assertion
  // below — on a loaded machine that budget could, in principle, run past
  // TAP_SHIELD_MS on its own before a test ever calls `advanceTimersByTime`.
  // The "still blocked" checks below advance by a *small* amount (not
  // close to TAP_SHIELD_MS) specifically to keep a wide real-time margin
  // before the shield could expire on its own; the precise 399ms/400ms
  // boundary, with no such drift at all, is covered by
  // `useTapShield.test.ts`, which uses a plain (fully synthetic)
  // `vi.useFakeTimers()`.
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
    // `findByRole` waits that out.
    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')

    // Only a small advance — see the beforeEach comment on why this stays
    // far below TAP_SHIELD_MS rather than just under it.
    act(() => {
      vi.advanceTimersByTime(50)
    })
    fireEvent.click(croissantTile)
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')

    // Comfortably past the full window from here, however much real time
    // the steps above actually took.
    act(() => {
      vi.advanceTimersByTime(TAP_SHIELD_MS)
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

  it('a tap on another screen (not Sell) is never blocked by the shield, which is proven still up back on Sell afterwards', async () => {
    render(<App database={database} />)
    await completeACashSale()

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))

    // The guard only applies while Sell is showing — its whole purpose is
    // to stop a stray tap landing on a product tile, and there is no such
    // tile here — so this tap on another screen must never be eaten.
    const row = await screen.findByRole('button', { name: /^#1/ })
    fireEvent.click(row)
    expect(await screen.findByRole('heading', { name: /Order #1/ })).toBeInTheDocument()

    // Nothing here advanced the shield's clock, so it must still be up —
    // prove that directly, rather than just trusting real time didn't
    // quietly outrun TAP_SHIELD_MS during the steps above (which would
    // make the assertions above pass vacuously, against an unscoped guard
    // too): back on Sell, the very next tile tap is still blocked.
    fireEvent.click(screen.getByRole('button', { name: 'Sell' }))
    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')
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
