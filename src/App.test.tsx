import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import type { CartScreenProps } from './screens/CartScreen'
import type { SellScreenProps } from './screens/SellScreen'

// Lets individual tests force the Cart or Sell screen to throw during
// render, to exercise App's ErrorBoundary (Try again / Back to Sell /
// Reload) without needing a real crash. `vi.hoisted` is required because
// `vi.mock` factories run before the rest of this module's top-level code.
const screenThrowFlags = vi.hoisted(() => ({ cart: false, sell: false }))

vi.mock('./screens/CartScreen', async () => {
  const actual =
    await vi.importActual<typeof import('./screens/CartScreen')>('./screens/CartScreen')
  return {
    CartScreen: (props: CartScreenProps) => {
      if (screenThrowFlags.cart) throw new Error('CartScreen boom (test)')
      return <actual.CartScreen {...props} />
    },
  }
})

vi.mock('./screens/SellScreen', async () => {
  const actual =
    await vi.importActual<typeof import('./screens/SellScreen')>('./screens/SellScreen')
  return {
    SellScreen: (props: SellScreenProps) => {
      if (screenThrowFlags.sell) throw new Error('SellScreen boom (test)')
      return <actual.SellScreen {...props} />
    },
  }
})

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
  screenThrowFlags.cart = false
  screenThrowFlags.sell = false
})

// Restores every spy/mock after each test, so a failing test's
// `console.error`/`fetch` spy can never leak into a later test. (This does
// not touch the vi.mock('./screens/...') module mocks above, which are
// reset per-test via screenThrowFlags in beforeEach instead.)
afterEach(() => {
  vi.restoreAllMocks()
})

describe('App', () => {
  it('seeds the menu, shows the Croissant tile, and updates the cart bar total on tap', async () => {
    render(<App database={database} />)

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)

    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    })
  })

  it('goes Sell -> Cart -> (step to 0) -> Back to Sell with an empty, disabled cart bar', async () => {
    render(<App database={database} />)

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    fireEvent.click(croissantTile)
    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿110')
    })

    fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))

    expect(await screen.findByRole('heading', { name: 'Cart' })).toBeInTheDocument()
    expect(document.querySelector('.cart-line-qty')?.textContent).toBe('2')
    expect(document.querySelector('.cart-bottom-bar-total')?.textContent).toBe('Total ฿110')

    fireEvent.click(screen.getByRole('button', { name: 'Remove one Croissant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Croissant' }))
    expect(await screen.findByText('Cart is empty.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Sell' }))

    const bar = await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')
    expect(bar).toBeDisabled()
  })

  it('shows no order confirmation before any sale', async () => {
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Croissant/ })
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<App database={database} />)

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    })
    fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
    await screen.findByRole('heading', { name: 'Cart' })

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('an error in the Cart screen shows Try again / Back to Sell / Reload; Back to Sell returns to Sell with the cart intact; Try again preserves the cart once recovered', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<App database={database} />)

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    })

    screenThrowFlags.cart = true
    fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /back to sell/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()

    // Back to Sell: the cart itself (held in App, above every boundary)
    // must be untouched by the crash.
    fireEvent.click(screen.getByRole('button', { name: /back to sell/i }))
    const bar = await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    expect(bar).not.toBeDisabled()

    // Try again while still broken remounts and errors again — no crash
    // escapes the boundary.
    fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()

    // Recover, and confirm the cart survived the whole crash/retry cycle.
    screenThrowFlags.cart = false
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(await screen.findByRole('heading', { name: 'Cart' })).toBeInTheDocument()
    expect(document.querySelector('.cart-bottom-bar-total')?.textContent).toBe('Total ฿55')
  })

  it('an error on the Sell screen itself (already home) shows no Back to Sell button', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    screenThrowFlags.sell = true
    render(<App database={database} />)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /back to sell/i })).not.toBeInTheDocument()
  })
})

describe('App — bottom nav', () => {
  it('shows the bottom nav on Sell, Orders, Report and Admin, highlighting the current one', async () => {
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Croissant/ })
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sell' })).toHaveAttribute('aria-current', 'page')

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))
    await screen.findByRole('heading', { name: 'Orders' })
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Sell' })).not.toHaveAttribute('aria-current')

    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    await screen.findByRole('heading', { name: 'Report' })
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    await screen.findByRole('heading', { name: 'Admin' })
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
  })

  it('hides the bottom nav on Cart, Cash and PromptPay', async () => {
    render(<App database={database} />)
    fireEvent.click(await screen.findByRole('button', { name: /Croissant/ }))
    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    })

    fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
    await screen.findByRole('heading', { name: 'Cart' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    await screen.findByRole('heading', { name: 'Cash' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }))
    await screen.findByRole('heading', { name: 'Cart' })
    fireEvent.click(screen.getByRole('button', { name: 'PromptPay' }))
    await screen.findByRole('heading', { name: 'PromptPay' })
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it('stays usable (navigable) even when the current screen has crashed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    screenThrowFlags.sell = true
    render(<App database={database} />)

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Orders' }))
    await screen.findByRole('heading', { name: 'Orders' })
  })
})
