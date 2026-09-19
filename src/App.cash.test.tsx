import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import { completeOrder } from './db/orders'
import type { ScreenProps } from './navigation'
import type { PlaceholderScreenProps } from './screens/PlaceholderScreen'

// App-level tests for the Cash checkout path. Owned by task 4, which replaces
// the placeholder with the real CashScreen and rewrites this file around it;
// task 5 must not edit it (see App.promptpay.test.tsx).
//
// Until then, this stands in for the Cash screen: the placeholder receives
// the full ScreenProps from the registry, so it adds a "Simulate sale" button
// that does what the real screen will do — store the order with
// completeOrder (฿100 tendered), then hand it to onOrderComplete.
vi.mock('./screens/PlaceholderScreen', async () => {
  const actual = await vi.importActual<typeof import('./screens/PlaceholderScreen')>(
    './screens/PlaceholderScreen',
  )
  return {
    PlaceholderScreen: (props: PlaceholderScreenProps & Partial<ScreenProps>) => {
      const { cart, database, onOrderComplete } = props
      const simulateSale = async () => {
        if (!cart || !database || !onOrderComplete) return
        const payment = { method: 'cash' as const, tendered: 10000, change: 10000 - cart.total }
        onOrderComplete(await completeOrder(cart.lines, payment, database))
      }
      return (
        <>
          <actual.PlaceholderScreen {...props} />
          <button type="button" onClick={() => void simulateSale()}>
            Simulate sale
          </button>
        </>
      )
    },
  }
})

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

async function addCroissantAndOpenCash() {
  fireEvent.click(await screen.findByRole('button', { name: /Croissant/ }))
  await waitFor(() => {
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
  })
  fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
  await screen.findByRole('heading', { name: 'Cart' })
  fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
  await screen.findByRole('heading', { name: 'Cash' })
}

describe('App — Cash checkout', () => {
  it('goes Sell -> Cart -> Cash -> Back to Sell with the cart intact', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Sell' }))

    await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    expect(await database.orders.count()).toBe(0)
  })

  it('a completed cash sale clears the cart, returns to Sell and shows "Order #N — change ฿X"', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: 'Simulate sale' }))

    // The status region is always mounted, so wait for its text, not the region.
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1 — change ฿45')
    })
    const bar = await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿0')
    expect(bar).toBeDisabled()

    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      number: 1,
      total: 5500,
      payment: { method: 'cash', tendered: 10000, change: 4500 },
    })

    // Tapping the confirmation dismisses it.
    fireEvent.click(screen.getByRole('button', { name: 'Order #1 — change ฿45' }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('a second sale replaces the previous confirmation', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Simulate sale' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    await addCroissantAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Simulate sale' }))

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #2 — change ฿45')
    })
    expect(screen.getByRole('status')).not.toHaveTextContent('Order #1')
    expect(await database.orders.count()).toBe(2)
  })

  it('never calls fetch on the way to a completed cash sale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<App database={database} />)
    await addCroissantAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Simulate sale' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
