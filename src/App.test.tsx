import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
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

  it('goes Sell -> Cart -> Cash placeholder -> Back to Sell with the cart intact', async () => {
    render(<App database={database} />)

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    })

    fireEvent.click(screen.getByRole('button', { name: /Cart:/ }))
    await screen.findByRole('heading', { name: 'Cart' })

    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))

    expect(await screen.findByRole('heading', { name: 'Cash' })).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Back to Sell' }))

    await screen.findByRole('button', { name: /Cart:/ })
    expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
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
    fetchSpy.mockRestore()
  })
})
