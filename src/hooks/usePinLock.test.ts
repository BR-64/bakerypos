import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MAX_PIN_ATTEMPTS, PIN_LOCKOUT_MS, UNLOCK_DURATION_MS } from '../domain/pin'
import { usePinLock } from './usePinLock'

// Only the timer functions are faked; `Date.now` is advanced with them
// (vitest's fake timers mock it by default), which is what the hook
// compares its deadlines against.
beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('usePinLock', () => {
  it('starts locked, with a full set of attempts', () => {
    const { result } = renderHook(() => usePinLock())

    expect(result.current.unlocked).toBe(false)
    expect(result.current.attemptsLeft).toBe(MAX_PIN_ATTEMPTS)
    expect(result.current.lockoutMsLeft).toBe(0)
  })

  it('unlocks for five minutes, then relocks on its own', () => {
    const { result } = renderHook(() => usePinLock())

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
    const { result } = renderHook(() => usePinLock())

    act(() => result.current.unlock())
    act(() => result.current.lock())

    expect(result.current.unlocked).toBe(false)
  })

  it('counts wrong attempts and locks out on the fifth for 60 seconds', () => {
    const { result } = renderHook(() => usePinLock())

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
    const { result } = renderHook(() => usePinLock())

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
    const { result } = renderHook(() => usePinLock())

    act(() => result.current.registerFailure())
    act(() => result.current.registerFailure())
    act(() => result.current.unlock())

    expect(result.current.attemptsLeft).toBe(MAX_PIN_ATTEMPTS)
  })

  it('unlocking during a lockout clears it (the recovery-code route)', () => {
    const { result } = renderHook(() => usePinLock())

    for (let i = 0; i < MAX_PIN_ATTEMPTS; i += 1) {
      act(() => result.current.registerFailure())
    }
    expect(result.current.lockoutMsLeft).toBe(PIN_LOCKOUT_MS)

    act(() => result.current.unlock())

    expect(result.current.lockoutMsLeft).toBe(0)
    expect(result.current.unlocked).toBe(true)
  })

  it('leaves no timer behind after unmount', () => {
    const { result, unmount } = renderHook(() => usePinLock())

    act(() => result.current.unlock())
    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a stable identity while nothing changes', () => {
    const { result, rerender } = renderHook(() => usePinLock())
    const first = result.current

    rerender()

    expect(result.current).toBe(first)
  })
})
