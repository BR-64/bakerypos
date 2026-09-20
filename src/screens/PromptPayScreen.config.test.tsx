import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import type { CartLine } from '../domain/types'
import { useCart } from '../hooks/useCart'
import { PromptPayScreen } from './PromptPayScreen'

// A separate file (its own module registry) so this mock of '../config'
// never leaks into PromptPayScreen.test.tsx's tests. Simulates the owner
// having already edited PROMPTPAY_ID to their real number: the warning must
// key off the true placeholder, not off whatever PROMPTPAY_ID happens to be
// — the bug this guards against is `isTestId` comparing `promptPayId` to
// `PROMPTPAY_ID` itself, which would trivially match here every time the
// screen uses its *default* prop, no matter what the owner configured.
vi.mock('../config', () => ({
  PLACEHOLDER_PROMPTPAY_ID: '0000000000',
  PROMPTPAY_ID: '0812345678',
}))

vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-testid="promptpay-qr" data-value={value} />
  ),
}))

const croissantLine: CartLine = {
  productId: 'p-croissant',
  name: 'Croissant',
  unitPrice: 5500,
  qty: 1,
}

describe('PromptPayScreen with a real (non-placeholder) configured PROMPTPAY_ID', () => {
  it('shows no test-ID warning and still renders the QR, using only the default prop', async () => {
    const database = new PosDatabase(`test-${Math.random()}`)
    await database.open()

    function Harness() {
      const cart = useCart([croissantLine])
      return (
        <PromptPayScreen
          cart={cart}
          navigate={() => {}}
          database={database}
          onOrderComplete={() => {}}
        />
      )
    }

    render(<Harness />)

    expect(screen.queryByText('Test PromptPay ID — not a real account')).not.toBeInTheDocument()
    expect(screen.getByTestId('promptpay-qr')).toBeInTheDocument()
  })
})
