import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'

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
  it('goes Sell -> Cart -> Cash -> Back to Cart with the cart intact', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }))

    await screen.findByRole('heading', { name: 'Cart' })
    expect(document.querySelector('.cart-bottom-bar-total')?.textContent).toBe('Total ฿55')
    expect(await database.orders.count()).toBe(0)
  })

  it('goes Sell -> Cart -> Cash -> Exact -> Sell with the toast and an empty cart', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenCash()

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))

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
      total: 5500,
      payment: { method: 'cash', tendered: 5500, change: 0 },
    })

    // Tapping the confirmation dismisses it.
    fireEvent.click(screen.getByRole('button', { name: 'Order #1 — change ฿0' }))
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('a second sale replaces the previous confirmation', async () => {
    render(<App database={database} />)
    await addCroissantAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    await addCroissantAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))

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
    await addCroissantAndOpenCash()
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Order #1')
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
