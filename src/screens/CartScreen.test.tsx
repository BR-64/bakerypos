import { fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CartLine, Product } from '../domain/types'
import { useCart } from '../hooks/useCart'
import type { Screen } from '../navigation'
import { CartScreen } from './CartScreen'

// Restores every spy/mock after each test, so a failing test's
// `console.error`/`fetch` spy can never leak into a later test.
afterEach(() => {
  vi.restoreAllMocks()
})

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

const croissantProduct: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'cookies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

/**
 * Renders CartScreen alongside two "outside" buttons that mutate the same
 * underlying `useCart` state directly (not through CartScreen's own UI),
 * simulating the cart being cleared/refilled by something other than this
 * screen's own Clear-confirm flow while it stays mounted.
 */
function SharedHarness({ initial }: { initial?: CartLine[] }) {
  const cart = useCart(initial)
  return (
    <div>
      <button type="button" onClick={() => cart.clear()}>
        Outside Clear
      </button>
      <button type="button" onClick={() => cart.add(croissantProduct)}>
        Outside Add
      </button>
      <CartScreen cart={cart} navigate={() => {}} />
    </div>
  )
}

/**
 * The cart-line total and the bottom-bar total can format to the same
 * text, so total assertions target the bottom bar specifically.
 */
function totalText(): string | null {
  return document.querySelector('.cart-bottom-bar-total')?.textContent ?? null
}

/**
 * Parses `formatBaht`'s display format (e.g. "฿9,007,199,254,740,991.50")
 * back into integer satang, independent of any internal computation, so a
 * test comparing "what's rendered" against "what's rendered" doesn't just
 * compare the same in-memory number to itself.
 */
function parseBahtToSatang(text: string): number {
  const negative = text.startsWith('-')
  const body = text.replace(/^-/, '').replace('฿', '').replace(/,/g, '')
  const [bahtStr, satangStr] = body.split('.')
  const satang = Number(bahtStr) * 100 + (satangStr ? Number(satangStr) : 0)
  return negative ? -satang : satang
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
  })

  it('(f) never calls fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    render(<Harness initial={[croissantLine]} navigate={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add one Croissant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))

    expect(fetchSpy).not.toHaveBeenCalled()
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

  it('the confirm text is singular for exactly one item and plural otherwise', () => {
    const singleLine: CartLine = { productId: 'p-cookie', name: 'Cookie', unitPrice: 4000, qty: 1 }
    render(<Harness initial={[singleLine]} navigate={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))
    expect(screen.getByText('Remove all 1 item?')).toBeInTheDocument()
    expect(screen.queryByText('Remove all 1 items?')).not.toBeInTheDocument()
  })

  it('the confirm text is plural for more than one item', () => {
    render(<Harness initial={[croissantLine]} navigate={() => {}} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))
    expect(screen.getByText('Remove all 2 items?')).toBeInTheDocument()
  })

  it('the clear confirm does not resurface if the cart is cleared and refilled from outside this screen while it is open', () => {
    render(<SharedHarness initial={[croissantLine]} />)

    fireEvent.click(screen.getByRole('button', { name: 'Clear cart' }))
    expect(screen.getByRole('group', { name: 'Clear cart?' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Outside Clear' }))
    expect(screen.queryByRole('group', { name: 'Clear cart?' })).not.toBeInTheDocument()
    expect(screen.getByText('Cart is empty.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Outside Add' }))

    // The cart is non-empty again, but the confirm must not have silently
    // resurfaced just because `confirming` was left stranded `true` while
    // hidden behind the (now false) `isEmpty` check.
    expect(screen.queryByRole('group', { name: 'Clear cart?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clear cart' })).toBeInTheDocument()
  })

  it('two valid lines sharing a productId never produce a duplicate-key warning; only the first is shown', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const first: CartLine = { productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }
    const duplicate: CartLine = {
      productId: 'p-croissant',
      name: 'Croissant (dup)',
      unitPrice: 5500,
      qty: 5,
    }

    render(<Harness initial={[first, duplicate]} navigate={() => {}} />)

    expect(document.querySelectorAll('.cart-line').length).toBe(1)
    expect(screen.getByText('Croissant')).toBeInTheDocument()
    expect(screen.queryByText('Croissant (dup)')).not.toBeInTheDocument()

    const duplicateKeyWarning = errorSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].toLowerCase().includes('same key'),
    )
    expect(duplicateKeyWarning).toBe(false)
  })

  it('the bottom-bar total always equals the sum of the rendered line totals, even when an overflowing line is present and hidden', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const first: CartLine = {
      productId: 'p-huge-a',
      name: 'Huge A',
      unitPrice: Number.MAX_SAFE_INTEGER - 20000,
      qty: 1,
    }
    // Would push the running total past Number.MAX_SAFE_INTEGER on top of
    // `first`, so partitionCartLines hides it — it must never be rendered
    // or counted, in the line list or the bottom bar.
    const overflowing: CartLine = {
      productId: 'p-huge-b',
      name: 'Huge B',
      unitPrice: Number.MAX_SAFE_INTEGER,
      qty: 1,
    }

    render(<Harness initial={[first, overflowing, croissantLine]} navigate={() => {}} />)

    expect(screen.queryByText('Huge B')).not.toBeInTheDocument()

    const renderedLineTotalsSum = Array.from(document.querySelectorAll('.cart-line-total')).reduce(
      (sum, el) => sum + parseBahtToSatang(el.textContent ?? ''),
      0,
    )
    const shownTotal = parseBahtToSatang((totalText() ?? '').replace('Total ', ''))

    expect(shownTotal).toBe(renderedLineTotalsSum)
  })
})
