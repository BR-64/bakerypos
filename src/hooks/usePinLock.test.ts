import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { getSettings, saveSettings } from '../db/settings'
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS, UNLOCK_DURATION_MS } from '../domain/pin'
import { DEFAULT_SETTINGS } from '../domain/settings'
import { usePinLock } from './usePinLock'

/**
 * A throwaway database per test, so a lockout written by one can't be seen
 * by the next — and so nothing here ever touches the app's real one.
 */
let database: PosDatabase

beforeEach(() => {
  database = new PosDatabase('test-' + Math.random())
})

// Only the timer functions are faked; `Date.now` is advanced with them
// (vitest's fake timers mock it by default), which is what the hook
// compares its deadlines against. The stored-lockout tests below turn
// them off again: fake-indexeddb never settles while the clock is faked.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePinLock', () => {
  it('starts locked, with a full set of attempts', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    expect(result.current.unlocked).toBe(false)
    expect(result.current.attemptsLeft).toBe(MAX_PIN_ATTEMPTS)
    expect(result.current.lockoutMsLeft).toBe(0)
  })

  it('unlocks for five minutes, then relocks on its own', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    act(() => result.current.unlock())
    expect(result.current.unlocked).toBe(true)

    act(() => {
      vi.advanceTimersByTime(UNLOCK_DURATION_MS - 1)
    })
    expect(result.current.unlocked).toBe(true)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.unlocked).toBe(false)
  })

  it('locks again immediately when asked', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    act(() => result.current.unlock())
    act(() => result.current.lock())

    expect(result.current.unlocked).toBe(false)
  })

  it('counts wrong attempts and locks out on the fifth for 60 seconds', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    for (let i = 1; i < MAX_PIN_ATTEMPTS; i += 1) {
      act(() => result.current.registerFailure())
      expect(result.current.attemptsLeft).toBe(MAX_PIN_ATTEMPTS - i)
      expect(result.current.lockoutMsLeft).toBe(0)
    }

    act(() => result.current.registerFailure())
    expect(result.current.lockoutMsLeft).toBe(PIN_LOCKOUT_MS)
    expect(result.current.unlocked).toBe(false)

    // The countdown re-renders once a second while it runs, so the
    // "try again in Ns" message is honest rather than frozen at 60.
    act(() => {
      vi.advanceTimersByTime(PIN_LOCKOUT_MS - 1000)
    })
    expect(result.current.lockoutMsLeft).toBe(1000)

    act(() => {
      vi.advanceTimersByTime(1000)
    })
    expect(result.current.lockoutMsLeft).toBe(0)
    expect(result.current.attemptsLeft).toBe(MAX_PIN_ATTEMPTS)
  })

  it('still relocks after five minutes when a lockout expired in between', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    act(() => result.current.unlock())
    // A lockout deadline sooner than the unlock deadline must not consume
    // the one timer and leave the unlock running past its five minutes.
    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      act(() => result.current.registerFailure())
    }

    act(() => {
      vi.advanceTimersByTime(PIN_LOCKOUT_MS)
    })
    expect(result.current.lockoutMsLeft).toBe(0)
    expect(result.current.unlocked).toBe(true)

    act(() => {
      vi.advanceTimersByTime(UNLOCK_DURATION_MS - PIN_LOCKOUT_MS)
    })
    expect(result.current.unlocked).toBe(false)
  })

  it('a successful unlock clears a part-used attempt count', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    act(() => result.current.registerFailure())
    act(() => result.current.registerFailure())
    act(() => result.current.unlock())

    expect(result.current.attemptsLeft).toBe(MAX_PIN_ATTEMPTS)
  })

  it('unlocking during a lockout clears it (the recovery-code route)', () => {
    const { result } = renderHook(() => usePinLock({ database }))

    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      act(() => result.current.registerFailure())
    }
    expect(result.current.lockoutMsLeft).toBe(PIN_LOCKOUT_MS)

    act(() => result.current.unlock())

    expect(result.current.lockoutMsLeft).toBe(0)
    expect(result.current.unlocked).toBe(true)
  })

  it('leaves no timer behind after unmount', () => {
    const { result, unmount } = renderHook(() => usePinLock({ database }))

    act(() => result.current.unlock())
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a stable identity while nothing changes', () => {
    const { result, rerender } = renderHook(() => usePinLock({ database }))
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})

describe('usePinLock — the lockout that survives a force-quit', () => {
  // Real timers throughout: every test here goes through Dexie, and
  // fake-indexeddb's own scheduling stalls while the clock is faked.
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('still holds after the app is force-quit and the database reopened', async () => {
    const name = 'test-' + Math.random()
    const firstRun = new PosDatabase(name)
    await saveSettings({ ...DEFAULT_SETTINGS, lockedUntil: Date.now() + 30_000 }, firstRun)
    // As close to a swipe-up from the app switcher as a test gets: the
    // handle goes away and a brand-new one opens the same data.
    firstRun.close()

    const relaunched = new PosDatabase(name)
    const stored = (await getSettings(relaunched)).lockedUntil
    const { result } = renderHook(() =>
      usePinLock({ database: relaunched, storedLockedUntil: stored }),
    )

    expect(stored).not.toBeNull()
    expect(result.current.lockoutMsLeft).toBeGreaterThan(25_000)
    expect(result.current.lockoutMsLeft).toBeLessThanOrEqual(30_000)
    expect(result.current.unlocked).toBe(false)
  })

  it('writes the deadline on the fifth wrong guess, and only then', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS }, database)
    const { result } = renderHook(() => usePinLock({ database }))

    for (let i = 1; i < MAX_PIN_ATTEMPTS; i += 1) {
      act(() => result.current.registerFailure())
    }
    // Four wrong guesses are a counter, not a lockout: nothing is stored.
    expect((await getSettings(database)).lockedUntil).toBeNull()

    const before = Date.now()
    act(() => result.current.registerFailure())

    await vi.waitFor(async () => {
      const stored = (await getSettings(database)).lockedUntil
      expect(stored).not.toBeNull()
      expect(stored).toBeGreaterThanOrEqual(before + PIN_LOCKOUT_MS)
      expect(stored).toBeLessThanOrEqual(Date.now() + PIN_LOCKOUT_MS)
    })
  })

  it('clears the stored deadline when the right PIN (or recovery code) lands', async () => {
    const lockedUntil = Date.now() + 30_000
    await saveSettings({ ...DEFAULT_SETTINGS, lockedUntil }, database)
    const { result } = renderHook(() => usePinLock({ database, storedLockedUntil: lockedUntil }))
    expect(result.current.lockoutMsLeft).toBeGreaterThan(0)

    act(() => result.current.unlock())

    // Cleared on screen straight away, not once the write lands.
    expect(result.current.lockoutMsLeft).toBe(0)
    expect(result.current.unlocked).toBe(true)
    await vi.waitFor(async () => {
      expect((await getSettings(database)).lockedUntil).toBeNull()
    })
  })

  it.each([
    [
      'a deadline further off than a whole lockout (a wrong clock)',
      Date.now() + 400 * 24 * 3600_000,
    ],
    ['a deadline already in the past', Date.now() - 1],
    ['a deadline of zero', 0],
    ['a negative deadline', -1],
    ['a non-integer deadline', 1.5],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a number too large to be exact', 1e300],
    ['a string', '9999999999999'],
    ['an object', { then: 1 }],
  ])('ignores %s, so nobody is locked out of their own shop', (_label, stored) => {
    const { result } = renderHook(() =>
      usePinLock({ database, storedLockedUntil: stored as number }),
    )

    expect(result.current.lockoutMsLeft).toBe(0)
  })

  it('scrubs a stored deadline it is already ignoring, so winding the clock back cannot revive it', async () => {
    // Ignored today (further off than one lockout), but still in the row —
    // and a device clock wound forward would bring it back into range.
    const stale = Date.now() + 10 * 24 * 3600_000
    await saveSettings({ ...DEFAULT_SETTINGS, lockedUntil: stale }, database)
    const { result } = renderHook(() => usePinLock({ database, storedLockedUntil: stale }))
    expect(result.current.lockoutMsLeft).toBe(0)

    act(() => result.current.unlock())

    await vi.waitFor(async () => {
      expect((await getSettings(database)).lockedUntil).toBeNull()
    })
  })

  it('keeps the lockout on screen even when storing it fails', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS }, database)
    const put = vi
      .spyOn(database.settings, 'put')
      .mockRejectedValue(new Error('the disk is full') as never)
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => usePinLock({ database }))

    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      act(() => result.current.registerFailure())
    }

    // The write is what fails, not the lockout: this session still holds
    // the keypad shut for its 60 seconds, and the failure is logged rather
    // than thrown out of the tap handler.
    expect(result.current.lockoutMsLeft).toBeGreaterThan(PIN_LOCKOUT_MS - 1000)
    await vi.waitFor(() => {
      expect(logged).toHaveBeenCalledWith(expect.stringContaining("couldn't store the lockout"))
    })
    put.mockRestore()
    logged.mockRestore()
  })

  it('does not write anything when the keypad is merely unlocked normally', async () => {
    await saveSettings({ ...DEFAULT_SETTINGS }, database)
    const put = vi.spyOn(database.settings, 'put')
    const { result } = renderHook(() => usePinLock({ database }))

    act(() => result.current.unlock())

    // No lockout was in force, so there is nothing to clear — a correct
    // PIN must not cost a settings write.
    expect(put).not.toHaveBeenCalled()
    put.mockRestore()
  })
})
