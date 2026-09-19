import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PROMPTPAY_ID } from '../config'
import { PosDatabase } from '../db/db'
import { promptPayPayload } from '../domain/promptpay'
import type { CartLine, Order } from '../domain/types'
import { useCart } from '../hooks/useCart'
import type { Screen } from '../navigation'
import { PromptPayScreen } from './PromptPayScreen'

// The real QRCodeSVG renders plain SVG (no canvas), so it's fine under
// jsdom — this mock exists only so tests can read the `value` a render was
// given without parsing an actual QR code.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value, title }: { value: string; title?: string }) => (
    <svg data-testid="promptpay-qr" data-value={value} aria-label={title} />
  ),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

const croissantLine: CartLine = {
  productId: 'p-croissant',
  name: 'Croissant',
  unitPrice: 5500,
  qty: 1,
}

const freeLine: CartLine = {
  productId: 'p-sample',
  name: 'Free sample',
  unitPrice: 0,
  qty: 1,
}

/** Renders PromptPayScreen with a real useCart(initial), the way App.tsx does. */
function Harness({
  initial,
  navigate = () => {},
  onOrderComplete = () => {},
  promptPayId,
}: {
  initial?: CartLine[]
  navigate?: (s: Screen) => void
  onOrderComplete?: (order: Order) => void
  promptPayId?: string
}) {
  const cart = useCart(initial)
  return (
    <PromptPayScreen
      cart={cart}
      navigate={navigate}
      database={database}
      onOrderComplete={onOrderComplete}
      promptPayId={promptPayId}
    />
  )
}

function qr(): HTMLElement | null {
  return screen.queryByTestId('promptpay-qr')
}

describe('PromptPayScreen', () => {
  it('renders a QR whose value is exactly promptPayPayload(id, total)', () => {
    render(<Harness initial={[croissantLine]} />)

    expect(qr()).toHaveAttribute('data-value', promptPayPayload(PROMPTPAY_ID, 5500))
  })

  it('shows the test-ID warning while the placeholder ID is in use', () => {
    render(<Harness initial={[croissantLine]} />)
    expect(screen.getByText('Test PromptPay ID — not a real account')).toBeInTheDocument()
  })

  it('hides the test-ID warning for a real-looking ID', () => {
    render(<Harness initial={[croissantLine]} promptPayId="0812345678" />)
    expect(screen.queryByText('Test PromptPay ID — not a real account')).not.toBeInTheDocument()
  })

  it('Cancel calls navigate("cart") without touching the cart', () => {
    const navigate = vi.fn()
    render(<Harness initial={[croissantLine]} navigate={navigate} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('cart')
  })

  it('"Paid — done" stores a promptpay payment with a valid confirmedAt and calls onOrderComplete once', async () => {
    const onOrderComplete = vi.fn()
    render(<Harness initial={[croissantLine]} onOrderComplete={onOrderComplete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({ total: 5500, payment: { method: 'promptpay' } })
    expect(order.payment.method).toBe('promptpay')
    if (order.payment.method === 'promptpay') {
      expect(Number.isNaN(new Date(order.payment.confirmedAt).getTime())).toBe(false)
    }
    expect(onOrderComplete).toHaveBeenCalledWith(order)
  })

  it('under StrictMode, a double tap on Paid creates exactly one order', async () => {
    const onOrderComplete = vi.fn()
    render(
      <StrictMode>
        <Harness initial={[croissantLine]} onOrderComplete={onOrderComplete} />
      </StrictMode>,
    )

    const paidButton = screen.getByRole('button', { name: 'Paid — done' })
    fireEvent.click(paidButton)
    fireEvent.click(paidButton)

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('a rejected save shows an error and keeps the cart; a retry then stores exactly one order', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    ;(
      vi.spyOn(database, 'transaction') as unknown as ReturnType<typeof vi.fn>
    ).mockRejectedValueOnce(new Error('disk full'))
    const onOrderComplete = vi.fn()
    render(<Harness initial={[croissantLine]} onOrderComplete={onOrderComplete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))

    await screen.findByRole('alert')
    expect(screen.getByRole('alert')).toHaveTextContent(/couldn't save/i)
    expect(onOrderComplete).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)
    // The cart is untouched — the QR (and its amount) is still shown.
    expect(qr()).toHaveAttribute('data-value', promptPayPayload(PROMPTPAY_ID, 5500))

    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))
    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('฿0 total shows "Nothing to charge — use Cash", no QR, and never writes', () => {
    render(<Harness initial={[freeLine]} />)

    expect(screen.getByText('Nothing to charge — use Cash')).toBeInTheDocument()
    expect(qr()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid — done' })).toBeDisabled()
  })

  it('an empty cart shows the empty state, no QR, and a disabled Paid button', () => {
    render(<Harness initial={[]} />)

    expect(screen.getByText('Cart is empty.')).toBeInTheDocument()
    expect(qr()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid — done' })).toBeDisabled()
  })

  it('an invalid PromptPay ID shows "PromptPay isn\'t set up", no QR, and a disabled Paid button', () => {
    render(<Harness initial={[croissantLine]} promptPayId="not-an-id" />)

    expect(screen.getByText("PromptPay isn't set up")).toBeInTheDocument()
    expect(qr()).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid — done' })).toBeDisabled()
  })

  it('never calls fetch on the way to a completed PromptPay sale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    const onOrderComplete = vi.fn()
    render(<Harness initial={[croissantLine]} onOrderComplete={onOrderComplete} />)

    fireEvent.click(screen.getByRole('button', { name: 'Paid — done' }))
    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
