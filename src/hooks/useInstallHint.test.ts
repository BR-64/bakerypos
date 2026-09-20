import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INSTALL_HINT_DISMISSED_KEY,
  isInstalledDisplay,
  shouldOfferInstallHint,
  useInstallHint,
} from './useInstallHint'

/**
 * jsdom's own `matchMedia` answers `false` to everything, which is exactly
 * a browser tab; tests that want the installed case replace it, and
 * `afterEach` puts the original back.
 */
const realMatchMedia = window.matchMedia

function pretendDisplayMode(mode: string): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes(mode),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia
}

beforeEach(() => {
  window.localStorage.clear()
})

afterEach(() => {
  window.matchMedia = realMatchMedia
  window.localStorage.clear()
})

describe('isInstalledDisplay', () => {
  it('is false in a plain browser tab', () => {
    expect(isInstalledDisplay()).toBe(false)
  })

  it.each(['standalone', 'minimal-ui', 'fullscreen'])('is true for display-mode: %s', (mode) => {
    pretendDisplayMode(mode)

    expect(isInstalledDisplay()).toBe(true)
  })

  it('is true for iOS Safari’s navigator.standalone', () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, get: () => true })
    try {
      expect(isInstalledDisplay()).toBe(true)
    } finally {
      // @ts-expect-error — jsdom has no such property; remove the override.
      delete navigator.standalone
    }
  })

  it('treats a matchMedia that throws as not installed', () => {
    window.matchMedia = (() => {
      throw new Error('no media queries here')
    }) as typeof window.matchMedia

    expect(isInstalledDisplay()).toBe(false)
  })
})

describe('shouldOfferInstallHint', () => {
  it('offers the hint in a fresh browser tab', () => {
    expect(shouldOfferInstallHint()).toBe(true)
  })

  it('does not offer it once installed, dismissed or not', () => {
    pretendDisplayMode('standalone')

    expect(shouldOfferInstallHint()).toBe(false)
  })

  it('does not offer it again once dismissed', () => {
    window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, '1')

    expect(shouldOfferInstallHint()).toBe(false)
  })

  it('offers it when localStorage cannot be read at all', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage is blocked')
    })

    expect(shouldOfferInstallHint()).toBe(true)
    getItem.mockRestore()
  })
})

describe('useInstallHint', () => {
  it('is visible in a tab and stays dismissed for the next launch', () => {
    const { result, unmount } = renderHook(() => useInstallHint())
    expect(result.current.visible).toBe(true)

    act(() => result.current.dismiss())
    expect(result.current.visible).toBe(false)
    expect(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe('1')

    unmount()
    const second = renderHook(() => useInstallHint())
    expect(second.result.current.visible).toBe(false)
  })

  it('starts hidden in an installed window', () => {
    pretendDisplayMode('standalone')

    const { result } = renderHook(() => useInstallHint())

    expect(result.current.visible).toBe(false)
  })

  it('still hides when the dismissal cannot be written', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage is full')
    })
    const { result } = renderHook(() => useInstallHint())

    act(() => result.current.dismiss())

    expect(result.current.visible).toBe(false)
    setItem.mockRestore()
  })
})
