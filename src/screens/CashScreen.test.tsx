import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import type { CartLine, Order } from '../domain/types'
import { useCart } from '../hooks/useCart'
import type { Screen } from '../navigation'
import { CashScreen } from './CashScreen'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Renders CashScreen with a real useCart(initial), the way App.tsx does. */
function Harness({
  initial,
  navigate,
  database,
  onOrderComplete,
}: {
  initial?: CartLine[]
  navigate: (s: Screen) => void
  database: PosDatabase
  onOrderComplete: (order: Order) => void
}) {
  const cart = useCart(initial)
  return (
    <CashScreen cart={cart} navigate={navigate} database={database} onOrderComplete={onOrderComplete} />
  )
}

const croissantLine: CartLine = {
  productId: 'p-croissant',
  name: 'Croissant',
  unitPrice: 5500,
  qty: 1,
}

const freeLine: CartLine = {
  productId: 'p-sample',
  name: 'Free Sample',
  unitPrice: 0,
  qty: 1,
}

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

describe('CashScreen', () => {
  it('Exact stores tendered = total and change 0, and calls onOrderComplete once', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      total: 5500,
      payment: { method: 'cash', tendered: 5500, change: 0 },
    })
  })

  it('a ฿500 note stores the correct change', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '฿500' }))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      total: 5500,
      payment: { method: 'cash', tendered: 50000, change: 44500 },
    })
  })

  it('under StrictMode, two taps in the same turn on a quick-tender note create exactly one order', async () => {
    const onOrderComplete = vi.fn()
    render(
      <StrictMode>
        <Harness
          initial={[croissantLine]}
          navigate={() => {}}
          database={database}
          onOrderComplete={onOrderComplete}
        />
      </StrictMode>,
    )

    const exactButton = screen.getByRole('button', { name: 'Exact ฿55' })
    // Both clicks dispatched before React processes either one, so this
    // exercises the same-turn double-tap guard for real, not just two
    // separately-flushed taps.
    act(() => {
      exactButton.click()
      exactButton.click()
    })

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('tapping two different quick-tender notes in quick succession creates exactly one order, for the first note tapped', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
    fireEvent.click(screen.getByRole('button', { name: '฿500' }))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
    const [order] = await database.orders.toArray()
    expect(order.payment).toEqual({ method: 'cash', tendered: 5500, change: 0 })
  })

  it('a rejected save shows an error and keeps the cart; a retry creates exactly one order', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onOrderComplete = vi.fn()
    ;(vi.spyOn(database, 'transaction') as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('disk full'),
    )
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))

    await screen.findByRole('alert')
    expect(onOrderComplete).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)
    // The cart is unchanged: the total is still shown and Exact is still there to retry.
    expect(screen.getByText('฿55')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('an always-rejecting save keeps showing the alert across a retry and never stores anything', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const onOrderComplete = vi.fn()
    const transactionSpy = vi.spyOn(
      database,
      'transaction',
    ) as unknown as ReturnType<typeof vi.fn>
    transactionSpy.mockRejectedValue(new Error('disk full'))
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
    await screen.findByRole('alert')
    expect(screen.getByText('฿55')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
    await waitFor(() => expect(transactionSpy).toHaveBeenCalledTimes(2))

    expect(screen.getByRole('alert')).toBeInTheDocument()
    expect(screen.getByText('฿55')).toBeInTheDocument()
    expect(onOrderComplete).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)
  })

  it('disables Back, every keypad key and every tender button while a note-tender save is pending', async () => {
    const onOrderComplete = vi.fn()
    const originalTransaction = database.transaction.bind(database) as (
      ...args: unknown[]
    ) => Promise<unknown>
    let resolveGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    ;(vi.spyOn(database, 'transaction') as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: unknown[]) => gate.then(() => originalTransaction(...args)),
    )

    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Back to Cart' })).toBeDisabled())
    ;['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach((digit) => {
      expect(screen.getByRole('button', { name: digit })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'Delete digit' })).toBeDisabled()
    for (const label of ['Exact ฿55', '฿100', '฿500', '฿1,000']) {
      expect(screen.getByRole('button', { name: label })).toBeDisabled()
    }

    resolveGate()
    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('disables Done and the keypad while a typed-amount save is pending', async () => {
    const onOrderComplete = vi.fn()
    const originalTransaction = database.transaction.bind(database) as (
      ...args: unknown[]
    ) => Promise<unknown>
    let resolveGate: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      resolveGate = resolve
    })
    ;(vi.spyOn(database, 'transaction') as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      (...args: unknown[]) => gate.then(() => originalTransaction(...args)),
    )

    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '6' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    fireEvent.click(screen.getByRole('button', { name: 'Done' }))

    await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeDisabled())
    ;['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'].forEach((digit) => {
      expect(screen.getByRole('button', { name: digit })).toBeDisabled()
    })
    expect(screen.getByRole('button', { name: 'Delete digit' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Back to Cart' })).toBeDisabled()

    resolveGate()
    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    expect(await database.orders.count()).toBe(1)
  })

  it('an empty cart shows "Cart is empty." and Back, and never writes', async () => {
    const onOrderComplete = vi.fn()
    const transactionSpy = vi.spyOn(database, 'transaction')
    render(
      <Harness initial={[]} navigate={() => {}} database={database} onOrderComplete={onOrderComplete} />,
    )

    expect(screen.getByText('Cart is empty.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to Cart' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Exact/ })).not.toBeInTheDocument()

    expect(transactionSpy).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)
    expect(onOrderComplete).not.toHaveBeenCalled()
  })

  it('a ฿0 cart (free items) completes with "Exact ฿0"', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[freeLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿0' }))

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      total: 0,
      payment: { method: 'cash', tendered: 0, change: 0 },
    })
  })

  it('Back to Cart navigates to the cart screen', () => {
    const navigate = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={navigate}
        database={database}
        onOrderComplete={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to Cart' }))
    expect(navigate).toHaveBeenCalledWith('cart')
  })

  it('Done is disabled while tendered < total, and clicking it anyway does nothing and never throws', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '1' }))
    expect(screen.getByText('฿54 short')).toBeInTheDocument()

    const doneButton = screen.getByRole('button', { name: 'Done' })
    expect(doneButton).toBeDisabled()

    expect(() => fireEvent.click(doneButton)).not.toThrow()
    expect(onOrderComplete).not.toHaveBeenCalled()
    expect(await database.orders.count()).toBe(0)
  })

  it('the keypad path stores the correct change once Done is enabled', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '6' }))
    fireEvent.click(screen.getByRole('button', { name: '0' }))
    expect(screen.getByText('Change ฿5')).toBeInTheDocument()

    const doneButton = screen.getByRole('button', { name: 'Done' })
    expect(doneButton).not.toBeDisabled()
    fireEvent.click(doneButton)

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [order] = await database.orders.toArray()
    expect(order).toMatchObject({
      total: 5500,
      payment: { method: 'cash', tendered: 6000, change: 500 },
    })
  })

  it('a typed amount exactly equal to the total enables Done and stores change 0', async () => {
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '5' }))
    fireEvent.click(screen.getByRole('button', { name: '5' }))
    expect(screen.getByText('Change ฿0')).toBeInTheDocument()

    const doneButton = screen.getByRole('button', { name: 'Done' })
    expect(doneButton).not.toBeDisabled()
    fireEvent.click(doneButton)

    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))
    const [order] = await database.orders.toArray()
    expect(order.payment).toEqual({ method: 'cash', tendered: 5500, change: 0 })
  })

  it('the Delete key removes the last digit typed, and the bottom bar shows quick-tender notes again once the entry is empty', () => {
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '6' }))
    expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete digit' }))

    expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Exact ฿55' })).toBeInTheDocument()
  })

  it('never calls fetch on the way to a completed cash sale', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    const onOrderComplete = vi.fn()
    render(
      <Harness
        initial={[croissantLine]}
        navigate={() => {}}
        database={database}
        onOrderComplete={onOrderComplete}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
    await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))

    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never uses XMLHttpRequest or sendBeacon on the checkout path', async () => {
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'send').mockImplementation(() => {
      throw new Error('XHR should never be used on the checkout path')
    })
    // jsdom doesn't implement sendBeacon by default; stub it only if missing,
    // and remove the stub again afterwards so it doesn't leak into other tests.
    const hadSendBeacon = typeof navigator.sendBeacon === 'function'
    if (!hadSendBeacon) {
      Object.defineProperty(navigator, 'sendBeacon', { value: () => false, configurable: true })
    }
    const beaconSpy = vi.spyOn(navigator, 'sendBeacon').mockImplementation(() => {
      throw new Error('sendBeacon should never be used on the checkout path')
    })

    try {
      const onOrderComplete = vi.fn()
      render(
        <Harness
          initial={[croissantLine]}
          navigate={() => {}}
          database={database}
          onOrderComplete={onOrderComplete}
        />,
      )

      fireEvent.click(screen.getByRole('button', { name: 'Exact ฿55' }))
      await waitFor(() => expect(onOrderComplete).toHaveBeenCalledTimes(1))

      expect(xhrSpy).not.toHaveBeenCalled()
      expect(beaconSpy).not.toHaveBeenCalled()
    } finally {
      beaconSpy.mockRestore()
      if (!hadSendBeacon) {
        // @ts-expect-error removing the stub we defined only for this test
        delete navigator.sendBeacon
      }
    }
  })
})
