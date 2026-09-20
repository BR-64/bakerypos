import { useCallback, useEffect, useMemo, useState } from 'react'
import { db, type PosDatabase } from '../db/db'
import { updateSettings } from '../db/settings'
import { safeString } from '../domain/log'
import {
  MAX_PIN_ATTEMPTS,
  PIN_LOCKOUT_MS,
  UNLOCK_DURATION_MS,
  usableLockoutDeadline,
} from '../domain/pin'

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

export interface PinLockOptions {
  /** Where the lockout is stored. Defaults to the app's database. */
  database?: PosDatabase
  /**
   * `settings.lockedUntil` as it was last read — App already holds the
   * settings row live (`useSettings`), so the lock reads it from there
   * rather than opening its own query.
   *
   * `null` covers both "no lockout stored" and "not read yet". Whatever
   * arrives is untrusted (it came back from Dexie): it is filtered through
   * `usableLockoutDeadline`, which ignores junk and anything more than one
   * lockout away.
   */
  storedLockedUntil?: number | null
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
 * The **unlock** is in-memory only, so it is gone when the app closes —
 * exactly what the SPEC asks of it ("5 minutes or until the app is
 * closed"). The **lockout** is not: it is written to the settings row
 * (`lockedUntil`), because otherwise force-quitting the app — a swipe up
 * from the app switcher — would be a five-second way around five wrong
 * guesses, which would make the lockout decorative in the one situation
 * it exists for. One write per lockout, never per wrong guess.
 *
 * A stored deadline can only ever hold the keypad for `PIN_LOCKOUT_MS`:
 * `usableLockoutDeadline` throws away anything malformed or further away
 * than one lockout, so a corrupt row or a wandering device clock cannot
 * shut the owner out of Admin — and so out of the recovery code, which is
 * behind the same keypad — for good.
 *
 * Both deadlines are compared against `Date.now()` at render rather than
 * against a stored "now", so a timer that never fires (a backgrounded
 * phone throttling timeouts) can't leave Admin unlocked past its 5
 * minutes. The timer only exists to force the re-render at the moment a
 * deadline passes; it is cleared on unmount.
 */
export function usePinLock({
  database = db,
  storedLockedUntil = null,
}: PinLockOptions = {}): PinLock {
  const [unlockedUntil, setUnlockedUntil] = useState<number | null>(null)
  const [ownLockedUntil, setOwnLockedUntil] = useState<number | null>(null)
  // Set by `unlock`: a correct PIN or recovery code ends the lockout here
  // and now, and the stored deadline must not drag it back while the write
  // clearing it is still in flight (or if that write fails outright).
  const [storedCleared, setStoredCleared] = useState(false)
  const [failures, setFailures] = useState(0)
  const [tick, setTick] = useState(0)

  // Reading the clock during render is impure, and here that is the point:
  // a stored "now" updated only by a timer would keep reporting `unlocked`
  // after a backgrounded phone throttled that timer, which is the one
  // direction this must never fail in. `tick` below forces the re-render at
  // each deadline; this line decides the answer.
  // eslint-disable-next-line react/purity
  const now = Date.now()
  const unlocked = unlockedUntil !== null && now < unlockedUntil

  // The lockout in force is the later of this session's own deadline and
  // the one a previous run stored, each filtered through
  // `usableLockoutDeadline` so neither a stale nor an absurd value can do
  // anything. No effect copies the stored value into state: it is simply
  // read every render, which means a settings read landing late (or a
  // write from elsewhere) can never fight with what the keypad is doing.
  const ownDeadline = usableLockoutDeadline(ownLockedUntil, now)
  const storedDeadline = storedCleared ? null : usableLockoutDeadline(storedLockedUntil, now)
  const lockedUntil =
    ownDeadline === null
      ? storedDeadline
      : storedDeadline === null
        ? ownDeadline
        : Math.max(ownDeadline, storedDeadline)
  const lockoutMsLeft = lockedUntil === null ? 0 : lockedUntil - now

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

  // Store the lockout deadline (or clear it). Fire-and-forget on purpose:
  // the keypad's own state has already changed, and a failed write must
  // not throw out of a tap handler. The cost of a lost write is at most
  // one lockout not surviving a force-quit, or one surviving 60 seconds
  // longer than it should.
  const persist = useCallback(
    (value: number | null) => {
      void updateSettings({ lockedUntil: value }, database).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : safeString(error)
        console.error(`usePinLock: couldn't store the lockout — ${message}`)
      })
    },
    [database],
  )

  const unlock = useCallback(() => {
    setUnlockedUntil(Date.now() + UNLOCK_DURATION_MS)
    setFailures(0)
    setOwnLockedUntil(null)
    // A correct PIN or recovery code ends any lockout, including one this
    // session inherited from the settings row — so ignore that one from
    // here on, and clear it on disk too.
    setStoredCleared(true)
    // Note `storedLockedUntil`, not just the lockout in force: a stored
    // deadline that `usableLockoutDeadline` currently rejects (it has
    // passed, or the device clock has moved) is still sitting in the row,
    // and winding the clock back would bring it into range again. This is
    // the one moment we know the person is entitled to be here, so it is
    // the moment to scrub it.
    if (lockedUntil !== null || storedLockedUntil !== null) persist(null)
  }, [lockedUntil, storedLockedUntil, persist])

  const lock = useCallback(() => setUnlockedUntil(null), [])

  const registerFailure = useCallback(() => {
    const next = failures + 1
    if (next >= MAX_PIN_ATTEMPTS) {
      // The count restarts with the lockout, so the sixth wrong guess after
      // it expires isn't instantly locked out again.
      setFailures(0)
      const deadline = Date.now() + PIN_LOCKOUT_MS
      setOwnLockedUntil(deadline)
      // The one write: a lockout that a force-quit could shrug off would
      // not be a lockout.
      setStoredCleared(false)
      persist(deadline)
      return
    }
    setFailures(next)
  }, [failures, persist])

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
