import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { getSettings, saveSettings } from '../db/settings'
import { generateSalt, hashPin, MAX_PIN_ATTEMPTS, normalizeRecoveryCode } from '../domain/pin'
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings'
import type { PinLock } from '../hooks/usePinLock'
import { PinPrompt } from './PinPrompt'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

/**
 * A stand-in for `usePinLock`, so this file tests the prompt's behaviour
 * (what it hashes, what it says, what it writes) while `usePinLock.test.ts`
 * tests the timing rules on their own.
 */
function stubLock(overrides: Partial<PinLock> = {}): PinLock {
  return {
    unlocked: false,
    lockoutMsLeft: 0,
    attemptsLeft: MAX_PIN_ATTEMPTS,
    unlock: vi.fn(),
    lock: vi.fn(),
    registerFailure: vi.fn(),
    ...overrides,
  }
}

function tapPin(pin: string): void {
  for (const digit of pin) {
    fireEvent.click(screen.getByRole('button', { name: digit }))
  }
}

async function storedSettingsWithPin(pin: string): Promise<Settings> {
  const pinSalt = generateSalt()
  const pinHash = await hashPin(pin, pinSalt)
  const recoveryHash = await hashPin(normalizeRecoveryCode('ABCD-EFGH-JKMN'), pinSalt)
  return { ...DEFAULT_SETTINGS, pinHash, pinSalt, recoveryHash }
}

describe('PinPrompt — first run (no PIN stored)', () => {
  it('sets a PIN, shows the recovery code once, and unlocks', async () => {
    const lock = stubLock()
    render(<PinPrompt settings={DEFAULT_SETTINGS} lock={lock} database={database} />)

    expect(screen.getByRole('heading', { name: 'Set a PIN for Admin' })).toBeInTheDocument()

    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))

    const code = await screen.findByText(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(screen.getByRole('heading', { name: 'Write this down' })).toBeInTheDocument()

    const stored = await getSettings(database)
    expect(stored.pinHash).toBeTruthy()
    // The whole point: nothing anywhere holds the PIN, or the code, as text.
    expect(JSON.stringify(stored)).not.toContain('1234')
    expect(JSON.stringify(stored)).not.toContain(code.textContent)
    expect(stored.pinHash).toBe(await hashPin('1234', stored.pinSalt as string))

    expect(lock.unlock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /written it down/ }))
    expect(lock.unlock).toHaveBeenCalledTimes(1)
  })

  it('refuses a mismatched confirmation and starts over', async () => {
    render(<PinPrompt settings={DEFAULT_SETTINGS} lock={stubLock()} database={database} />)

    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('9999')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/didn’t match/)
    expect(screen.getByRole('heading', { name: 'Set a PIN for Admin' })).toBeInTheDocument()
    expect(await getSettings(database)).toEqual(DEFAULT_SETTINGS)
  })

  it('will not submit fewer than four digits', () => {
    render(<PinPrompt settings={DEFAULT_SETTINGS} lock={stubLock()} database={database} />)

    tapPin('123')

    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('keeps the form usable when the save is rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.settings, 'put').mockRejectedValue(new Error('disk full'))
    const lock = stubLock()
    render(<PinPrompt settings={DEFAULT_SETTINGS} lock={lock} database={database} />)

    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('1234')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(lock.unlock).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled()
  })
})

describe('PinPrompt — entering a stored PIN', () => {
  it('unlocks on the right PIN', async () => {
    const settings = await storedSettingsWithPin('4821')
    const lock = stubLock()
    render(<PinPrompt settings={settings} lock={lock} database={database} />)

    expect(screen.getByRole('heading', { name: 'Enter the PIN for Admin' })).toBeInTheDocument()
    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(lock.unlock).toHaveBeenCalledTimes(1))
    expect(lock.registerFailure).not.toHaveBeenCalled()
  })

  it('rejects a wrong PIN, counts it, and clears the entry', async () => {
    const settings = await storedSettingsWithPin('4821')
    const lock = stubLock()
    render(<PinPrompt settings={settings} lock={lock} database={database} />)

    tapPin('0000')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Wrong PIN. 4 tries left.')
    expect(lock.unlock).not.toHaveBeenCalled()
    expect(lock.registerFailure).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('0 digits entered')).toBeInTheDocument()
  })

  it('masks the digits — they are never rendered as text', () => {
    render(<PinPrompt settings={DEFAULT_SETTINGS} lock={stubLock()} database={database} />)

    tapPin('4821')

    expect(screen.getByLabelText('4 digits entered')).toHaveTextContent('●●●●')
    expect(screen.queryByText('4821')).not.toBeInTheDocument()
  })

  it('shows the lockout message and disables the keypad while locked out', () => {
    const lock = stubLock({ lockoutMsLeft: 60_000, attemptsLeft: MAX_PIN_ATTEMPTS })
    render(<PinPrompt settings={DEFAULT_SETTINGS} lock={lock} database={database} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong tries. Try again in 60s.')
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
  })

  it('closes the recovery route during a lockout instead of leading to a dead view', async () => {
    const settings = await storedSettingsWithPin('4821')
    const lock = stubLock({ lockoutMsLeft: 45_000 })
    const { rerender } = render(<PinPrompt settings={settings} lock={lock} database={database} />)

    expect(screen.getByRole('button', { name: 'Forgot the PIN?' })).toBeDisabled()

    // And if the lockout starts while the recovery view is already open,
    // it says so there rather than just disabling everything silently.
    rerender(<PinPrompt settings={settings} lock={stubLock()} database={database} />)
    fireEvent.click(screen.getByRole('button', { name: 'Forgot the PIN?' }))
    rerender(<PinPrompt settings={settings} lock={lock} database={database} />)

    expect(screen.getByRole('heading', { name: 'Enter the recovery code' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Too many wrong tries. Try again in 45s.')
    expect(screen.getByLabelText('Recovery code')).toBeDisabled()
  })

  it('says so, without burning an attempt, when Web Crypto is unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const settings = await storedSettingsWithPin('4821')
    const lock = stubLock()
    render(<PinPrompt settings={settings} lock={lock} database={database} />)
    vi.stubGlobal('crypto', undefined)

    tapPin('4821')
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/https/)
    vi.unstubAllGlobals()
    expect(lock.registerFailure).not.toHaveBeenCalled()
    expect(lock.unlock).not.toHaveBeenCalled()
  })
})

describe('PinPrompt — recovery code', () => {
  it('resets the PIN, issues a new code and unlocks', async () => {
    const settings = await storedSettingsWithPin('4821')
    await saveSettings(settings, database)
    const lock = stubLock()
    render(<PinPrompt settings={settings} lock={lock} database={database} />)

    fireEvent.click(screen.getByRole('button', { name: 'Forgot the PIN?' }))
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: 'abcd-efgh-jkmn' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Recovery code accepted')

    tapPin('5678')
    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    tapPin('5678')
    fireEvent.click(screen.getByRole('button', { name: 'Save PIN' }))

    const newCode = await screen.findByText(
      /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/,
    )
    expect(newCode.textContent).not.toBe('ABCD-EFGH-JKMN')

    const stored = await getSettings(database)
    expect(stored.pinHash).toBe(await hashPin('5678', stored.pinSalt as string))
    expect(stored.pinHash).not.toBe(settings.pinHash)
    // The old recovery code is dead too — a new salt and a new code.
    expect(stored.recoveryHash).not.toBe(settings.recoveryHash)

    fireEvent.click(screen.getByRole('button', { name: /written it down/ }))
    expect(lock.unlock).toHaveBeenCalledTimes(1)
  })

  it('counts a wrong recovery code as a failed attempt and changes nothing', async () => {
    const settings = await storedSettingsWithPin('4821')
    await saveSettings(settings, database)
    const lock = stubLock()
    render(<PinPrompt settings={settings} lock={lock} database={database} />)

    fireEvent.click(screen.getByRole('button', { name: 'Forgot the PIN?' }))
    fireEvent.change(screen.getByLabelText('Recovery code'), {
      target: { value: 'ZZZZ-ZZZZ-ZZZZ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset PIN' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn’t right/)
    expect(lock.registerFailure).toHaveBeenCalledTimes(1)
    expect(lock.unlock).not.toHaveBeenCalled()
    await expect(getSettings(database)).resolves.toEqual(settings)
  })

  it('offers no recovery route when no recovery hash is stored', async () => {
    const settings = await storedSettingsWithPin('4821')
    render(
      <PinPrompt
        settings={{ ...settings, recoveryHash: null }}
        lock={stubLock()}
        database={database}
      />,
    )

    expect(screen.queryByRole('button', { name: 'Forgot the PIN?' })).not.toBeInTheDocument()
  })
})

describe('PinPrompt — settings not usable', () => {
  it('waits, rather than offering to set a PIN, while settings are loading', () => {
    render(<PinPrompt settings={null} lock={stubLock()} database={database} />)

    expect(screen.getByText('Checking the PIN…')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
  })

  it('still offers a way out while loading, for the inline Void prompt', () => {
    const onCancel = vi.fn()
    render(<PinPrompt settings={null} lock={stubLock()} database={database} onCancel={onCancel} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(onCancel).toHaveBeenCalledTimes(1)
  })

  it('fails closed when the settings read failed', () => {
    // Otherwise breaking a read would be enough to be offered the
    // first-run flow and overwrite the real PIN.
    render(<PinPrompt settings={DEFAULT_SETTINGS} settingsFailed lock={stubLock()} />)

    expect(screen.getByRole('alert')).toHaveTextContent(/stays locked/)
    expect(screen.queryByRole('button', { name: '1' })).not.toBeInTheDocument()
  })
})
