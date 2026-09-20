import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TAP_SHIELD_MS, useTapShield } from './useTapShield'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useTapShield', () => {
  it('starts inactive', () => {
    const { result } = renderHook(() => useTapShield())
    expect(result.current.active).toBe(false)
  })

  it('is active immediately after raise(), and still active just before TAP_SHIELD_MS', () => {
    const { result } = renderHook(() => useTapShield())

    act(() => result.current.raise())
    expect(result.current.active).toBe(true)

    act(() => vi.advanceTimersByTime(TAP_SHIELD_MS - 1))
    expect(result.current.active).toBe(true)
  })

  it('becomes inactive at exactly TAP_SHIELD_MS', () => {
    const { result } = renderHook(() => useTapShield())

    act(() => result.current.raise())
    act(() => vi.advanceTimersByTime(TAP_SHIELD_MS))
    expect(result.current.active).toBe(false)
  })

  it('a re-raise while active restarts the timer rather than stacking', () => {
    const { result } = renderHook(() => useTapShield())

    act(() => result.current.raise())
    act(() => vi.advanceTimersByTime(TAP_SHIELD_MS - 1))
    expect(result.current.active).toBe(true)

    // Re-raise with 1ms left: if it stacked, the original timer firing 1ms
    // later would incorrectly clear it while the second raise should still
    // be active for another ~400ms.
    act(() => result.current.raise())
    act(() => vi.advanceTimersByTime(1))
    expect(result.current.active).toBe(true)

    act(() => vi.advanceTimersByTime(TAP_SHIELD_MS - 1))
    expect(result.current.active).toBe(false)
  })

  it('memoizes its return value: same reference across a re-render with no state change', () => {
    const { result, rerender } = renderHook(() => useTapShield())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })

  it('returns a new reference only when `active` itself changes', () => {
    const { result } = renderHook(() => useTapShield())
    const beforeRaise = result.current

    act(() => result.current.raise())
    const afterRaise = result.current
    expect(afterRaise).not.toBe(beforeRaise)
    expect(afterRaise.raise).toBe(beforeRaise.raise)

    act(() => vi.advanceTimersByTime(TAP_SHIELD_MS))
    expect(result.current).not.toBe(afterRaise)
  })

  it('leaves no timer running after unmount', () => {
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout')
    const { result, unmount } = renderHook(() => useTapShield())

    act(() => result.current.raise())
    unmount()

    expect(clearSpy).toHaveBeenCalled()
    // Advancing time after unmount must not throw or do anything observable.
    expect(() => vi.advanceTimersByTime(TAP_SHIELD_MS * 2)).not.toThrow()
  })
})
