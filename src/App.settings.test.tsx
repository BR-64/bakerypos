import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import { saveSettings } from './db/settings'
import { PLACEHOLDER_PROMPTPAY_ID, promptPayPayload } from './domain/promptpay'
import { DEFAULT_SETTINGS, type Settings } from './domain/settings'

// The real QRCodeSVG renders plain SVG, so it works under jsdom — this
// mock only makes the encoded `value` readable without decoding a QR.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => (
    <svg data-testid="promptpay-qr" data-value={value} />
  ),
}))

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const realId = '0812345678'
const stored: Settings = { ...DEFAULT_SETTINGS, shopName: 'Sunrise Bakery', promptPayId: realId }

const TEST_ID_WARNING = 'Test PromptPay ID — not a real account'

/** Sell -> tap a Croissant -> Cart -> PromptPay, the way staff get there. */
async function goToPromptPay(): Promise<void> {
  fireEvent.click(await screen.findByRole('button', { name: /Croissant/ }))
  fireEvent.click(await screen.findByRole('button', { name: /Cart:/ }))
  await screen.findByRole('heading', { name: 'Cart' })
  fireEvent.click(screen.getByRole('button', { name: 'PromptPay' }))
  await screen.findByRole('heading', { name: 'PromptPay' })
}

function qr(): HTMLElement | null {
  return screen.queryByTestId('promptpay-qr')
}

describe('App — PromptPay ID from the settings table', () => {
  it('uses a stored real ID for the QR, with no test-ID warning', async () => {
    await saveSettings(stored, database)
    render(<App database={database} />)

    await goToPromptPay()

    await waitFor(() => expect(qr()).toHaveAttribute('data-value', promptPayPayload(realId, 5500)))
    expect(screen.queryByText(TEST_ID_WARNING)).not.toBeInTheDocument()
  })

  it('falls back to the placeholder — QR *and* warning — when no settings row exists', async () => {
    render(<App database={database} />)

    await goToPromptPay()

    await waitFor(() =>
      expect(qr()).toHaveAttribute('data-value', promptPayPayload(PLACEHOLDER_PROMPTPAY_ID, 5500)),
    )
    expect(screen.getByText(TEST_ID_WARNING)).toBeInTheDocument()
  })

  it('a failing settings read still renders Sell, and PromptPay says it is not set up rather than showing a placeholder QR', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.settings, 'get').mockRejectedValue(new Error('IndexedDB is gone'))

    render(<App database={database} />)

    // `useSettings` runs in App's body, above every ErrorBoundary — a
    // re-thrown rejection here would take Sell, the cart bar and the nav
    // down together, leaving nothing to tap.
    expect(await screen.findByRole('button', { name: /Croissant/ })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()

    await goToPromptPay()

    // Task 7b: a failed read is no longer treated like "no row yet". We
    // don't know the shop's ID, so no QR is built from a default the owner
    // may well have replaced with a real account.
    await waitFor(() =>
      expect(screen.getByText('PromptPay isn’t set up — use Cash')).toBeInTheDocument(),
    )
    expect(qr()).not.toBeInTheDocument()
    expect(screen.queryByText(TEST_ID_WARNING)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid — done' })).toBeDisabled()
  })

  it('shows no QR at all while the settings read is still in flight, then the stored one once it lands', async () => {
    let release!: (value: Settings) => void
    const gate = new Promise<Settings>((resolve) => {
      release = resolve
    })
    ;(vi.spyOn(database.settings, 'get') as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
      gate,
    )

    render(<App database={database} />)
    await goToPromptPay()

    // settings === null: "not loaded yet", never "use the defaults".
    expect(screen.getByText('Loading PromptPay settings…')).toBeInTheDocument()
    expect(qr()).not.toBeInTheDocument()
    expect(screen.queryByText(TEST_ID_WARNING)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid — done' })).toBeDisabled()

    release(stored)

    await waitFor(() => expect(qr()).toHaveAttribute('data-value', promptPayPayload(realId, 5500)))
    expect(screen.queryByText('Loading PromptPay settings…')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Paid — done' })).toBeEnabled()
  })

  it('never calls fetch while reading settings and showing the QR', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    await saveSettings(stored, database)
    render(<App database={database} />)

    await goToPromptPay()
    await waitFor(() => expect(qr()).toBeInTheDocument())

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
