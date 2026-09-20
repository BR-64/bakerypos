import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useOnlineStatus } from './useOnlineStatus'

/**
 * `navigator.onLine` is an accessor property in a real browser (and in
 * jsdom), so it is replaced with `defineProperty` and deleted again
 * afterwards — an assignment would either be ignored or leave the property
 * permanently shadowed for later test files.
 */
function setOnLine(value: unknown): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

afterEach(() => {
  // @ts-expect-error — removing the override restores jsdom's own getter.
  delete navigator.onLine
})

describe('useOnlineStatus', () => {
  it('reports what navigator.onLine says at first render', () => {
    setOnLine(false)

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(false)
  })

  it('toggles on the offline and online events', () => {
    setOnLine(true)
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)

    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })

  it('counts a non-boolean navigator.onLine as online', () => {
    setOnLine(undefined)

    const { result } = renderHook(() => useOnlineStatus())

    expect(result.current).toBe(true)
  })

  it('removes its listeners on unmount', () => {
    setOnLine(true)
    const { result, unmount } = renderHook(() => useOnlineStatus())

    unmount()
    setOnLine(false)
    window.dispatchEvent(new Event('offline'))

    // An unmounted hook must not still be reacting to window events.
    expect(result.current).toBe(true)
  })
})
