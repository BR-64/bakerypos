import { useState } from 'react'
import './PinPrompt.css'
import { db, type PosDatabase } from '../db/db'
import { updateSettings } from '../db/settings'
import { safeString } from '../domain/log'
import {
  generateRecoveryCode,
  generateSalt,
  hashPin,
  isValidPin,
  MAX_PIN_LENGTH,
  MIN_PIN_LENGTH,
  normalizeRecoveryCode,
  verifyPin,
} from '../domain/pin'
import type { Settings } from '../domain/settings'
import type { PinLock } from '../hooks/usePinLock'

export interface PinPromptProps {
  /** The stored settings, or `null` while the read is still in flight. */
  settings: Settings | null
  /**
   * True when the settings read **failed**. The prompt then refuses to do
   * anything: it can't check a PIN it couldn't read, and offering the
   * first-run "set a PIN" flow here would let anyone overwrite the real
   * one just by breaking a read.
   */
  settingsFailed?: boolean
  /** Shared unlock/attempt/lockout state from `App` (see `usePinLock`). */
  lock: PinLock
  database?: PosDatabase
  /** What is being unlocked, e.g. "Admin" or "Void". Used in the heading. */
  purpose?: string
  /** Shown as a "Cancel" button when given — the Void panel uses it. */
  onCancel?: () => void
}

type Step = 'enter' | 'set' | 'confirm' | 'recover' | 'show-recovery'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']

/**
 * The PIN keypad that guards Admin and Void (`docs/SPEC.md`).
 *
 * Four states, picked from what's stored rather than from a mode prop:
 *
 * - **no PIN stored** — the first-run flow: choose a PIN, confirm it, then
 *   the one-time recovery code is shown **once** and never again (only its
 *   hash is stored);
 * - **PIN stored** — enter it. Five wrong tries and the keypad locks for 60
 *   seconds; the count and the lockout live in `usePinLock`, up in `App`,
 *   so leaving the screen and coming back doesn't clear them;
 * - **forgot it** — type the recovery code, which resets the PIN and issues
 *   a new recovery code;
 * - **can't tell** — settings still loading, or the read failed. Neither
 *   shows the set-PIN flow: the lock fails closed.
 *
 * The PIN itself never leaves this component. What's written is
 * `hashPin(pin, salt)` plus the salt (`src/domain/pin.ts`), through
 * `updateSettings`, which merges rather than replacing the row.
 */
export function PinPrompt({
  settings,
  settingsFailed = false,
  lock,
  database = db,
  purpose = 'Admin',
  onCancel,
}: PinPromptProps) {
  const [entry, setEntry] = useState('')
  const [firstEntry, setFirstEntry] = useState('')
  const [recoveryEntry, setRecoveryEntry] = useState('')
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState<Step | null>(null)

  const hasPin = settings !== null && settings.pinHash !== null && settings.pinSalt !== null
  const lockedOut = lock.lockoutMsLeft > 0
  // The step is derived from what's stored until the person moves it on
  // themselves, so a settings read landing late can't strand the prompt in
  // the wrong flow.
  const currentStep: Step = step ?? (hasPin ? 'enter' : 'set')

  if (settingsFailed) {
    return (
      <section className="pin-prompt" aria-label={`${purpose} locked`}>
        <p className="pin-prompt-message" role="alert">
          Couldn&rsquo;t read the PIN settings, so {purpose} stays locked. Close and reopen the app,
          then try again.
        </p>
        {onCancel && (
          <button type="button" className="pin-prompt-cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
      </section>
    )
  }

  if (settings === null) {
    return (
      <section className="pin-prompt" aria-label={`${purpose} locked`}>
        <p className="pin-prompt-message muted">Checking the PIN…</p>
      </section>
    )
  }

  function fail(error: unknown, fallback: string): void {
    const text = error instanceof Error ? error.message : safeString(error)
    console.error(`PinPrompt: ${fallback} — ${text}`)
    setMessage(text || fallback)
    setBusy(false)
  }

  /** Write a brand-new PIN (first run, or after a recovery) and show its code once. */
  async function storeNewPin(pin: string): Promise<void> {
    setBusy(true)
    try {
      const salt = generateSalt()
      const code = generateRecoveryCode()
      const [pinHash, recoveryHash] = await Promise.all([
        hashPin(pin, salt),
        hashPin(normalizeRecoveryCode(code), salt),
      ])
      await updateSettings({ pinHash, pinSalt: salt, recoveryHash }, database)
      setRecoveryCode(code)
      setEntry('')
      setFirstEntry('')
      setMessage(null)
      setBusy(false)
      setStep('show-recovery')
    } catch (error) {
      setEntry('')
      setFirstEntry('')
      setStep('set')
      fail(error, "Couldn't save the PIN")
    }
  }

  async function submitEntry(): Promise<void> {
    if (busy || lockedOut || !isValidPin(entry) || settings === null) return

    if (currentStep === 'set') {
      setFirstEntry(entry)
      setEntry('')
      setMessage(null)
      setStep('confirm')
      return
    }

    if (currentStep === 'confirm') {
      if (entry !== firstEntry) {
        setEntry('')
        setFirstEntry('')
        setMessage('Those PINs didn’t match. Choose a PIN again.')
        setStep('set')
        return
      }
      await storeNewPin(entry)
      return
    }

    // currentStep === 'enter'
    setBusy(true)
    try {
      const ok = await verifyPin(entry, settings.pinSalt, settings.pinHash)
      setEntry('')
      setBusy(false)
      if (ok) {
        setMessage(null)
        lock.unlock()
        return
      }
      lock.registerFailure()
      // `attemptsLeft` is one render behind here, so this reads the value
      // after this failure rather than before it.
      const left = lock.attemptsLeft - 1
      setMessage(
        left > 0
          ? `Wrong PIN. ${left} ${left === 1 ? 'try' : 'tries'} left.`
          : 'Wrong PIN. Too many tries.',
      )
    } catch (error) {
      // A crypto failure is not a wrong PIN: say so instead of burning an
      // attempt for something the person can't fix by typing more slowly.
      setEntry('')
      fail(error, "Couldn't check the PIN")
    }
  }

  async function submitRecovery(): Promise<void> {
    if (busy || lockedOut || settings === null) return
    const normalized = normalizeRecoveryCode(recoveryEntry)
    if (normalized.length === 0) return
    setBusy(true)
    try {
      const ok = await verifyPin(normalized, settings.pinSalt, settings.recoveryHash)
      setBusy(false)
      if (ok) {
        setRecoveryEntry('')
        setEntry('')
        setMessage('Recovery code accepted. Choose a new PIN.')
        setStep('set')
        return
      }
      lock.registerFailure()
      setRecoveryEntry('')
      setMessage('That recovery code isn’t right.')
    } catch (error) {
      setRecoveryEntry('')
      fail(error, "Couldn't check the recovery code")
    }
  }

  function press(digit: string): void {
    if (busy || lockedOut) return
    setEntry((current) => (current.length >= MAX_PIN_LENGTH ? current : current + digit))
  }

  function backspace(): void {
    if (busy || lockedOut) return
    setEntry((current) => current.slice(0, -1))
  }

  if (currentStep === 'show-recovery' && recoveryCode !== null) {
    return (
      <section className="pin-prompt" aria-label="Recovery code">
        <h2 className="pin-prompt-heading">Write this down</h2>
        <p className="pin-prompt-recovery-code">{recoveryCode}</p>
        <p className="pin-prompt-message">
          This is the only way back in if the PIN is forgotten. It is shown once and is not stored
          anywhere you can read it again.
        </p>
        <button
          type="button"
          className="pin-prompt-submit"
          onClick={() => {
            setRecoveryCode(null)
            setStep(null)
            lock.unlock()
          }}
        >
          I&rsquo;ve written it down
        </button>
      </section>
    )
  }

  if (currentStep === 'recover') {
    return (
      <section className="pin-prompt" aria-label="Reset the PIN">
        <h2 className="pin-prompt-heading">Enter the recovery code</h2>
        {message && (
          <p className="pin-prompt-message" role="alert">
            {message}
          </p>
        )}
        <input
          type="text"
          className="pin-prompt-recovery-input"
          aria-label="Recovery code"
          placeholder="ABCD-EFGH-JKMN"
          autoComplete="off"
          value={recoveryEntry}
          disabled={busy || lockedOut}
          onChange={(event) => setRecoveryEntry(event.target.value)}
        />
        <div className="pin-prompt-actions">
          <button
            type="button"
            className="pin-prompt-cancel"
            disabled={busy}
            onClick={() => {
              setRecoveryEntry('')
              setMessage(null)
              setStep('enter')
            }}
          >
            Back
          </button>
          <button
            type="button"
            className="pin-prompt-submit"
            disabled={busy || lockedOut || normalizeRecoveryCode(recoveryEntry).length === 0}
            onClick={() => void submitRecovery()}
          >
            Reset PIN
          </button>
        </div>
      </section>
    )
  }

  const heading =
    currentStep === 'set'
      ? `Set a PIN for ${purpose}`
      : currentStep === 'confirm'
        ? 'Enter the PIN again'
        : `Enter the PIN for ${purpose}`
  const submitLabel =
    currentStep === 'enter' ? 'Unlock' : currentStep === 'set' ? 'Next' : 'Save PIN'

  return (
    <section className="pin-prompt" aria-label={`${purpose} locked`}>
      <h2 className="pin-prompt-heading">{heading}</h2>
      {currentStep !== 'enter' && (
        <p className="pin-prompt-message muted">
          {MIN_PIN_LENGTH}–{MAX_PIN_LENGTH} digits. There is no way to read it back, so choose
          something the whole counter can remember.
        </p>
      )}

      <p className="pin-prompt-dots" aria-label={`${entry.length} digits entered`}>
        {'●'.repeat(entry.length) || '–'}
      </p>

      {lockedOut ? (
        <p className="pin-prompt-message" role="alert">
          Too many wrong tries. Try again in {Math.ceil(lock.lockoutMsLeft / 1000)}s.
        </p>
      ) : (
        message && (
          <p className="pin-prompt-message" role="alert">
            {message}
          </p>
        )
      )}

      <div className="pin-prompt-keypad">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className="pin-prompt-key"
            disabled={busy || lockedOut}
            onClick={() => press(key)}
          >
            {key}
          </button>
        ))}
        <button
          type="button"
          className="pin-prompt-key pin-prompt-key-delete"
          disabled={busy || lockedOut || entry.length === 0}
          onClick={backspace}
        >
          Delete
        </button>
      </div>

      <div className="pin-prompt-actions">
        {onCancel && (
          <button type="button" className="pin-prompt-cancel" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
        )}
        <button
          type="button"
          className="pin-prompt-submit"
          disabled={busy || lockedOut || !isValidPin(entry)}
          onClick={() => void submitEntry()}
        >
          {submitLabel}
        </button>
      </div>

      {currentStep === 'enter' && settings.recoveryHash !== null && (
        <button
          type="button"
          className="pin-prompt-forgot"
          disabled={busy}
          onClick={() => {
            setEntry('')
            setMessage(null)
            setStep('recover')
          }}
        >
          Forgot the PIN?
        </button>
      )}
    </section>
  )
}
