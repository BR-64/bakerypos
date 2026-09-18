import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import type { CartLine } from '../domain/types'
import { useCart } from '../hooks/useCart'
import type { Screen } from '../navigation'
import { CartScreen } from './CartScreen'

/** Renders CartScreen with a real useCart(initial), the way App.tsx does. */
function Harness({ initial, navigate }: { initial?: CartLine[]; navigate: (s: Screen) => void }) {
  const cart = useCart(initial)
  return <CartScreen cart={cart} navigate={navigate} />
}

const croissantLine: CartLine = {
  productId: 'p-croissant',
  name: 'Croissant',
  unitPrice: 5500,
  qty: 2,
}

/**
 * The cart-line total and the bottom-bar total can format to the same
 * text, so total assertions target the bottom bar specifically.
 */
function totalText(): string | null {
  return document.querySelector('.cart-bottom-bar-total')?.textContent ?? null
}

describe('CartScreen', () => {
  it('(a) + and - update the total, and stepping to 0 removes the line and shows the empty state with Cash/PromptPay/Clear disabled', () => {
    render(<Harness initial={[croissantLine]} navigate={() => {}} />)

    expect(totalText()).toBe('Total ฿110')

    fireEvent.click(screen.getByRole('button', { name: 'Add one Croissant' }))
    expect(totalText()).toBe('Total ฿165')

    fireEvent.click(screen.getByRole('button', { name: 'Remove one Croissant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Croissant' }))
    expect(totalText()).toBe('Total ฿55')

    fireEvent.click(screen.getByRole('button', { name: 'Remove one Croissant' }))

    expect(totalText()).toBe('Total ฿0')
    expect(screen.getByText('Cart is empty.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cash' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'PromptPay' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Clear cart' })).toBeDisabled()
  })

  it('(b) Clear shows the confirm without changing the cart; Keep has focus and closes it with the cart intact; Yes, clear empties the cart and navigates to sell once', () => {
    const navigate = vi.fn()
    render(<Harness initial={[croissantLine]} navigate={navigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))

    expect(screen.getByRole('group', { name: 'Clear cart?' })).toBeInTheDocument()
    expect(screen.getByText('Remove all 2 items?')).toBeInTheDocument()
    expect(totalText()).toBe('Total ฿110')

    const keepButton = screen.getByRole('button', { name: 'Keep' })
    expect(keepButton).toHaveFocus()

    fireEvent.click(keepButton)
    expect(screen.queryByRole('group', { name: 'Clear cart?' })).not.toBeInTheDocument()
    expect(totalText()).toBe('Total ฿110')
    expect(screen.getByRole('button', { name: 'Clear cart' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, clear' }))

    expect(screen.getByText('Cart is empty.')).toBeInTheDocument()
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('sell')
  })

  it('(c) Cash and PromptPay each call navigate with their screen in one tap', () => {
    const navigate = vi.fn()
    render(<Harness initial={[croissantLine]} navigate={navigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('cash')

    fireEvent.click(screen.getByRole('button', { name: 'PromptPay' }))
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(navigate).toHaveBeenCalledWith('promptpay')
  })

  it('(d) Back calls navigate("sell") and leaves the cart unchanged', () => {
    const navigate = vi.fn()
    render(<Harness initial={[croissantLine]} navigate={navigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Back to Sell' }))

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('sell')
    expect(totalText()).toBe('Total ฿110')
  })

  it('(e) corrupt initial lines are skipped, excluded from the total, and logged once each; no error fallback appears', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const corrupt: CartLine[] = [
      { productId: '', name: 'Bad Id', unitPrice: 100, qty: 1 },
      { productId: 'p-blank', name: '   ', unitPrice: 100, qty: 1 },
      { productId: 'p-neg', name: 'Negative', unitPrice: -50, qty: 1 },
    ]

    expect(() =>
      render(<Harness initial={[croissantLine, ...corrupt]} navigate={() => {}} />),
    ).not.toThrow()

    expect(screen.queryByText('Bad Id')).not.toBeInTheDocument()
    expect(screen.queryByText('Negative')).not.toBeInTheDocument()
    expect(document.querySelectorAll('.cart-line').length).toBe(1)
    expect(totalText()).toBe('Total ฿110')
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()

    expect(errorSpy).toHaveBeenCalledTimes(3)

    errorSpy.mockRestore()
  })

  it('(f) never calls fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<Harness initial={[croissantLine]} navigate={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add one Croissant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('(g) under StrictMode, one + tap adds exactly 1', () => {
    render(
      <StrictMode>
        <Harness initial={[croissantLine]} navigate={() => {}} />
      </StrictMode>,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Add one Croissant' }))
    expect(totalText()).toBe('Total ฿165')
    expect(document.querySelector('.cart-line-qty')?.textContent).toBe('3')
  })

  it('(h) with the confirm open, stepping the last line to 0 closes it', () => {
    const cookieLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 }
    render(<Harness initial={[cookieLine]} navigate={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))
    expect(screen.getByRole('group', { name: 'Clear cart?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Remove one Cookie' }))

    expect(screen.queryByRole('group', { name: 'Clear cart?' })).not.toBeInTheDocument()
    expect(screen.getByText('Cart is empty.')).toBeInTheDocument()
  })
})
