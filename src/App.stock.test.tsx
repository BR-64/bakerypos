import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'

// The whole stock loop through the real app (task 8d): Admin sets a count,
// a cash sale takes one off the Sell tile, a void in Orders puts it back.

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const BROWNIE = /Brownie 9 cubes/

function tapPin(pin: string): void {
  for (const digit of pin) fireEvent.click(screen.getByRole('button', { name: digit }))
}

function goTo(tab: 'Sell' | 'Orders' | 'Report' | 'Admin'): void {
  fireEvent.click(screen.getByRole('button', { name: tab }))
}

async function brownieTile(): Promise<HTMLElement> {
  return screen.findByRole('button', { name: BROWNIE })
}

describe('App — stock', () => {
  it('Admin sets 5, a cash sale shows 4 on the tile, a void puts it back to 5', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called')
    })
    render(<App database={database} />)

    // Untracked to begin with: the tile shows no count.
    expect((await brownieTile()).querySelector('.tile-stock')).toBeNull()

    // Unlock Admin — a fresh device, so this sets the PIN.
    goTo('Admin')
    await screen.findByRole('heading', { name: 'Set a PIN for Admin' })
    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    fireEvent.click(await screen.findByRole('button', { name: /written it down/ }))

    fireEvent.click(await screen.findByRole('button', { name: 'Set count for Brownie 9 cubes' }))
    fireEvent.change(screen.getByLabelText('New count for Brownie 9 cubes'), {
      target: { value: '5' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Stock: 5')).toBeInTheDocument()

    // Sell → Cart → Cash → Exact.
    goTo('Sell')
    await waitFor(async () => expect(await brownieTile()).toHaveAccessibleDescription('Stock: 5'))
    fireEvent.click(await brownieTile())
    // Adding to the cart doesn't move stock — only a confirmed sale does.
    expect(await brownieTile()).toHaveAccessibleDescription('Stock: 5')
    fireEvent.click(await screen.findByRole('button', { name: /Cart:/ }))
    await screen.findByRole('heading', { name: 'Cart' })
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    await screen.findByRole('heading', { name: 'Cash' })
    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿300' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Order #1'))

    await waitFor(async () => {
      const tile = await brownieTile()
      expect(tile).toHaveAccessibleDescription('Stock: 4')
      expect(tile.querySelector('.tile-stock')).toHaveTextContent('Stock: 4')
    })
    expect((await database.products.get('p-brownie-9'))?.stock).toBe(4)

    // Void it in Orders. Admin was unlocked a moment ago, so the PIN is
    // only asked for if that unlock has lapsed.
    goTo('Orders')
    fireEvent.click(await screen.findByRole('button', { name: /^#1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Void this order' }))
    if (screen.queryByRole('heading', { name: 'Enter the PIN for Void' }) !== null) {
      tapPin('1234')
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    }
    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void' }))
    await waitFor(async () => expect((await database.orders.toArray())[0].status).toBe('voided'))

    goTo('Sell')
    await waitFor(async () => {
      const tile = await brownieTile()
      expect(tile).toHaveAccessibleDescription('Stock: 5')
      expect(tile.querySelector('.tile-stock')).toHaveTextContent('Stock: 5')
    })
    expect((await database.products.get('p-brownie-9'))?.stock).toBe(5)
    // Stock never touches the manual sold-out toggle.
    expect((await database.products.get('p-brownie-9'))?.outOfStock).toBe(false)

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
