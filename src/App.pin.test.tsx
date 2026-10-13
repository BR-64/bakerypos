import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { PosDatabase } from './db/db'
import { getSettings, saveSettings } from './db/settings'
import {
  generateSalt,
  hashPin,
  MAX_PIN_ATTEMPTS,
  normalizeRecoveryCode,
  PIN_LOCKOUT_MS,
  UNLOCK_DURATION_MS,
} from './domain/pin'
import { DEFAULT_SETTINGS, type Settings } from './domain/settings'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const RECOVERY_CODE = 'ABCD-EFGH-JKMN'

/** A settings row with a real PIN hash, as a device that has been set up holds it. */
async function settingsWithPin(pin: string): Promise<Settings> {
  const pinSalt = generateSalt()
  return {
    ...DEFAULT_SETTINGS,
    pinHash: await hashPin(pin, pinSalt),
    pinSalt,
    recoveryHash: await hashPin(normalizeRecoveryCode(RECOVERY_CODE), pinSalt),
  }
}

function tapPin(pin: string): void {
  for (const digit of pin) fireEvent.click(screen.getByRole('button', { name: digit }))
}

function goTo(tab: 'Sell' | 'Orders' | 'Report' | 'Admin'): void {
  fireEvent.click(screen.getByRole('button', { name: tab }))
}

/**
 * Move the app's clock forward without faking timers, which fake-indexeddb
 * and Dexie both keep running on. `usePinLock` compares its deadlines
 * against `Date.now()` at render (deliberately, so a throttled phone can't
 * hold an unlock open), so this is exactly what a returning staff member
 * five minutes later sees.
 */
function skipAhead(ms: number): void {
  const resumeAt = Date.now() + ms
  vi.spyOn(Date, 'now').mockImplementation(() => resumeAt)
}

describe('App — the checkout path never asks for a PIN', () => {
  it('goes Sell → Cart → Cash → paid with no keypad anywhere', async () => {
    render(<App database={database} />)

    fireEvent.click(await screen.findByRole('button', { name: /Brownie 9 cubes/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Cart:/ }))
    await screen.findByRole('heading', { name: 'Cart' })
    fireEvent.click(screen.getByRole('button', { name: 'Cash' }))
    await screen.findByRole('heading', { name: 'Cash' })

    expect(screen.queryByText(/Enter the PIN/)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Exact ฿300' }))

    expect(await screen.findByText(/Order #1/)).toBeInTheDocument()
    expect(await database.orders.count()).toBe(1)
    expect(screen.queryByText(/Enter the PIN/)).not.toBeInTheDocument()
    expect(screen.queryByText(/Set a PIN/)).not.toBeInTheDocument()
  })

  it('never asks on Orders or Report either — only Admin and Void do', async () => {
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Brownie 9 cubes/ })

    goTo('Orders')
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument()
    expect(screen.queryByText(/PIN/)).not.toBeInTheDocument()

    goTo('Report')
    expect(await screen.findByRole('heading', { name: 'Report' })).toBeInTheDocument()
    expect(screen.queryByText(/PIN/)).not.toBeInTheDocument()
  })
})

describe('App — first run sets the PIN', () => {
  it('asks for a new PIN, shows the recovery code once, then opens Admin', async () => {
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Brownie 9 cubes/ })

    goTo('Admin')

    expect(await screen.findByRole('heading', { name: 'Set a PIN for Admin' })).toBeInTheDocument()
    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))

    const code = await screen.findByText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    const codeText = code.textContent ?? ''
    fireEvent.click(screen.getByRole('button', { name: /written it down/ }))

    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()

    // Neither the PIN nor the recovery code is stored anywhere in the row.
    const row = await database.settings.get('shop')
    expect(JSON.stringify(row)).not.toContain('1234')
    expect(JSON.stringify(row)).not.toContain(codeText)
    expect((await getSettings(database)).pinHash).toMatch(/^[0-9a-f]{64}$/)

    // Shown once: leaving Admin and coming back never shows it again.
    goTo('Sell')
    goTo('Admin')
    expect(screen.queryByText(codeText)).not.toBeInTheDocument()
  })
})

describe('App — unlocking Admin', () => {
  it('rejects a wrong PIN and opens on the right one', async () => {
    const settings = await settingsWithPin('4821')
    await saveSettings(settings, database)
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Brownie 9 cubes/ })

    goTo('Admin')
    await screen.findByRole('heading', { name: 'Enter the PIN for Admin' })

    tapPin('0000')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong PIN. 4 tries left.')
    expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument()

    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()
    // The stored row is untouched by a failed attempt, and still holds no
    // plain-text PIN.
    expect(await getSettings(database)).toEqual(settings)
    expect(JSON.stringify(await database.settings.get('shop'))).not.toContain('4821')
  })

  it('locks the keypad for 60 seconds after five wrong attempts, across a remount', async () => {
    await saveSettings(await settingsWithPin('4821'), database)
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Brownie 9 cubes/ })

    goTo('Admin')
    await screen.findByRole('heading', { name: 'Enter the PIN for Admin' })

    for (let attempt = 0; attempt < MAX_PIN_ATTEMPTS; attempt += 1) {
      tapPin('0000')
      fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
      await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument())
    }

    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many wrong tries/)
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()

    // Leaving Admin and coming back remounts the prompt; the lockout lives
    // in App, so it is still counting.
    goTo('Sell')
    goTo('Admin')
    expect(await screen.findByRole('alert')).toHaveTextContent(/Too many wrong tries/)
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()

    // 60 seconds later the keypad works again and the right PIN opens Admin.
    skipAhead(PIN_LOCKOUT_MS + 1)
    goTo('Sell')
    goTo('Admin')
    await screen.findByRole('heading', { name: 'Enter the PIN for Admin' })
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled()

    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })

  it('stays unlocked for five minutes, then asks again', async () => {
    await saveSettings(await settingsWithPin('4821'), database)
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Brownie 9 cubes/ })

    goTo('Admin')
    await screen.findByRole('heading', { name: 'Enter the PIN for Admin' })
    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()

    // Still open a minute later, without retyping anything.
    skipAhead(60_000)
    goTo('Sell')
    goTo('Admin')
    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()

    skipAhead(UNLOCK_DURATION_MS + 1)
    goTo('Sell')
    goTo('Admin')

    expect(
      await screen.findByRole('heading', { name: 'Enter the PIN for Admin' }),
    ).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument()
  })

  it('resets the PIN with the recovery code, and the old PIN stops working', async () => {
    const settings = await settingsWithPin('4821')
    await saveSettings(settings, database)
    render(<App database={database} />)
    await screen.findByRole('button', { name: /Brownie 9 cubes/ })

    goTo('Admin')
    await screen.findByRole('heading', { name: 'Enter the PIN for Admin' })
    fireEvent.click(screen.getByRole('button', { name: 'Forgot the PIN?' }))
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: RECOVERY_CODE.toLowerCase() },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Recovery code accepted')
    tapPin('5678')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('5678')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))
    await screen.findByRole('heading', { name: 'Write this down' })
    fireEvent.click(screen.getByRole('button', { name: /written it down/ }))

    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()

    const stored = await getSettings(database)
    expect(stored.pinHash).not.toBe(settings.pinHash)
    expect(stored.pinHash).toBe(await hashPin('5678', stored.pinSalt as string))
    expect(JSON.stringify(await database.settings.get('shop'))).not.toContain('5678')

    // Lock up again: the old PIN is gone, the new one works.
    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))
    await screen.findByRole('heading', { name: 'Enter the PIN for Admin' })
    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong PIN')

    tapPin('5678')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })

  it('unlocking for a void also opens Admin for the rest of the five minutes', async () => {
    await saveSettings(await settingsWithPin('4821'), database)
    render(<App database={database} />)

    // One cash sale, so there is something to void.
    fireEvent.click(await screen.findByRole('button', { name: /Brownie 9 cubes/ }))
    fireEvent.click(await screen.findByRole('button', { name: /Cart:/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cash' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Exact ฿300' }))
    await screen.findByText(/Order #1/)

    goTo('Orders')
    // `/^#1/`, not `/#1/`: the "Order #1 — change ฿0" toast is a button too,
    // and tapping that would only dismiss it.
    fireEvent.click(await screen.findByRole('button', { name: /^#1/ }))
    fireEvent.click(await screen.findByRole('button', { name: 'Void this order' }))

    expect(
      await screen.findByRole('heading', { name: 'Enter the PIN for Void' }),
    ).toBeInTheDocument()
    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    fireEvent.click(await screen.findByRole('button', { name: 'Duplicate order' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, void' }))
    await waitFor(async () => expect((await database.orders.toArray())[0].status).toBe('voided'))

    goTo('Admin')
    expect(await screen.findByRole('button', { name: 'Add product' })).toBeInTheDocument()
  })
})
