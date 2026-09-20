import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShareText } from './useShareText'

const TEXT = 'Bakery — Z report\n2026-01-15'

/**
 * Installs a navigator API for one test. `Object.defineProperty` with
 * `configurable: true` (rather than assignment) because `navigator.share`
 * and `navigator.clipboard` are accessor properties in a real browser and
 * plain assignment silently does nothing; `undefined` models the API not
 * existing at all, shadowing anything jsdom may define on the prototype.
 */
function installNavigatorApi(name: 'share' | 'clipboard', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true })
}

// Every stub is an own property of `navigator`, so deleting it here leaves
// the object exactly as the next test file finds it — nothing leaks.
afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'clipboard')
  vi.restoreAllMocks()
})

function abortError(): Error {
  const error = new Error('Share canceled')
  error.name = 'AbortError'
  return error
}

describe('useShareText — the share sheet', () => {
  it('calls navigator.share synchronously in the handler, and leaves the clipboard alone', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('clipboard', { writeText })

    const { result } = renderHook(() => useShareText())

    act(() => {
      result.current.share(TEXT)
      // Inside the same turn as the tap — the browser only opens the share
      // sheet during the gesture, so an `await` before this call would
      // lose it.
      expect(share).toHaveBeenCalledTimes(1)
    })

    expect(share).toHaveBeenCalledWith({ text: TEXT })
    await waitFor(() => expect(result.current.copied).toBe(false))
    expect(writeText).not.toHaveBeenCalled()
    expect(result.current.fallbackText).toBeNull()
  })

  it('treats an AbortError as a silent cancel: no clipboard, no error, no fallback', async () => {
    const share = vi.fn().mockRejectedValue(abortError())
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('clipboard', { writeText })

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    // Cancelling the sheet must not overwrite whatever the person had
    // already copied.
    expect(writeText).not.toHaveBeenCalled()
    expect(result.current.copied).toBe(false)
    expect(result.current.fallbackText).toBeNull()
  })

  it('falls through to the clipboard for any other rejection', async () => {
    const share = vi.fn().mockRejectedValue(new Error('no share handler'))
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('clipboard', { writeText })

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    await waitFor(() => expect(result.current.copied).toBe(true))
    expect(writeText).toHaveBeenCalledWith(TEXT)
    expect(result.current.fallbackText).toBeNull()
  })

  it('falls through to the clipboard when navigator.share throws synchronously', async () => {
    const share = vi.fn(() => {
      throw new Error('not allowed')
    })
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('clipboard', { writeText })

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    await waitFor(() => expect(result.current.copied).toBe(true))
    expect(writeText).toHaveBeenCalledWith(TEXT)
  })
})

describe('useShareText — the clipboard', () => {
  it('copies straight to the clipboard when there is no share API', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', { writeText })

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    await waitFor(() => expect(result.current.copied).toBe(true))
    expect(writeText).toHaveBeenCalledWith(TEXT)
  })

  it('shows the fallback text when the clipboard write is refused', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', { writeText })

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    await waitFor(() => expect(result.current.fallbackText).toBe(TEXT))
    expect(result.current.copied).toBe(false)
  })
})

describe('useShareText — neither API', () => {
  it('hands back the text for a selectable textarea', async () => {
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', undefined)

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    expect(result.current.fallbackText).toBe(TEXT)
    expect(result.current.copied).toBe(false)
  })

  it('clears a previous result at the start of the next share', async () => {
    installNavigatorApi('share', undefined)
    installNavigatorApi('clipboard', undefined)

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })
    expect(result.current.fallbackText).toBe(TEXT)

    const writeText = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('clipboard', { writeText })
    await act(async () => {
      result.current.share('something else')
    })

    await waitFor(() => expect(result.current.copied).toBe(true))
    expect(result.current.fallbackText).toBeNull()
  })

  it('never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called')
    })
    installNavigatorApi('share', vi.fn().mockResolvedValue(undefined))

    const { result } = renderHook(() => useShareText())
    await act(async () => {
      result.current.share(TEXT)
    })

    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
