import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('seeds the menu, shows the Croissant tile, and updates the cart bar total on tap', async () => {
    render(<App />)

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)

    await waitFor(() => {
      expect(document.querySelector('.cart-bar-total')?.textContent).toBe('฿55')
    })
  })
})
