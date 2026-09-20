import { useCallback, useEffect, useMemo, useState } from 'react'
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS, UNLOCK_DURATION_MS } from '../domain/pin'

export interface PinLock {
  /** True while Admin (and Void) are unlocked. False once the 5 minutes are up. */
  unlocked: boolean
  /** Milliseconds left on the 60-second lockout; 0 when the keypad is usable. */
  lockoutMsLeft: number
  /** Attempts left before the lockout starts. `MAX_PIN_ATTEMPTS` when fresh. */
  attemptsLeft: number
  /** A correct PIN (or recovery code): unlock for 5 minutes and clear failures. */
  unlock: () => void
  /** Lock again straight away — the Admin screen's "Lock" button. */
  lock: () => void
  /** A wrong PIN: count it, and start the lockout on the fifth. */
  registerFailure: () => void
}

/**
 * Where the PIN lock's state lives.
 *
 * `App.tsx` calls this **once**, above every `ErrorBoundary`, and passes
 * the result down as `ScreenProps.pinLock`, so:
 *
 * - the unlock is shared — unlocking to void an order also opens Admin for
 *   the rest of the 5 minutes, which is what "entering the PIN unlocks
 *   Admin for 5 minutes" means for one person holding one phone;
 * - the wrong-attempt count and the lockout **survive a remount of the
 *   prompt**. That is the point of holding them here rather than inside
 *   `PinPrompt`: otherwise five wrong guesses could be shrugged off by
 *   tapping Sell and then Admin again, which would make the lockout
 *   decorative.
 *
 * All of it is in-memory only, so it is gone when the app closes — exactly
 * what the SPEC asks of the unlock ("5 minutes or until the app is
 * closed"). The lockout goes with it: persisting a countdown to Dexie
 * would mean a write per wrong guess, and a clock-based lockout stored on
 * the device it is defending buys little. This is a counter-top kiosk,
 * not a bank.
 *
 * Both deadlines are compared against `Date.now()` at render rather than
 * against a stored "now", so a timer that never fires (a backgrounded
 * phone throttling timeouts) can't leave Admin unlocked past its 5
 * minutes. The timer only exists to force the re-render at the moment a
 * deadline passes; it is cleared on unmount.
 */
export function usePinLock(): PinLock {
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null)
  const [lockedUntil, setLockedUntil] = useState<number | null>(null)
  const [failures, setFailures] = useState(0)
  const [tick, setTick] = useState(0)

  const now = Date.now()
  const unlocked = unlockedUntil !== null && now < unlockedUntil
  const lockoutMsLeft = lockedUntil !== null && now < lockedUntil ? lockedUntil - now : 0

  // Re-render exactly when the next deadline passes, so "unlocked" and the
  // lockout message stop being true on their own, with no polling.
  useEffect(() => {
    const startedAt = Date.now()
    const deadlines = [unlockedUntil, lockedUntil].filter(
      (d): d is number => d !== null && d > startedAt,
    )
    if (deadlines.length === 0) return
    let next = Math.min(...deadlines)
    // While a lockout is counting down, re-render once a second as well, so
    // "try again in Ns" counts down instead of sitting frozen at 60.
    if (lockedUntil !== null && lockedUntil > startedAt) next = Math.min(next, startedAt + 1000)
    const timer = setTimeout(() => setTick((t) => t + 1), Math.max(0, next - startedAt))
    return () => clearTimeout(timer)
    // `tick` is a dependency so that after one deadline passes this reruns
    // and schedules the *next* one — a lockout expiring must not leave the
    // 5-minute unlock with no timer of its own.
  }, [unlockedUntil, lockedUntil, tick])

  const unlock = useCallback(() => {
    setUnlockedUntil(Date.now() + UNLOCK_DURATION_MS)
    setFailures(0)
    setLockedUntil(null)
  }, [])

  const lock = useCallback(() => setUnlockedUntil(null), [])

  const registerFailure = useCallback(() => {
    const next = failures + 1
    if (next >= MAX_PIN_ATTEMPTS) {
      // The count restarts with the lockout, so the sixth wrong guess after
      // it expires isn't instantly locked out again.
      setFailures(0)
      setLockedUntil(Date.now() + PIN_LOCKOUT_MS)
      return
    }
    setFailures(next)
  }, [failures])

  return useMemo(
    () => ({
      unlocked,
      lockoutMsLeft,
      attemptsLeft: Math.max(0, MAX_PIN_ATTEMPTS - failures),
      unlock,
      lock,
      registerFailure,
    }),
    [unlocked, lockoutMsLeft, failures, unlock, lock, registerFailure],
  )
}
