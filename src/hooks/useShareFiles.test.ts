import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useShareFiles, type ShareFile } from './useShareFiles'

const FILES: ShareFile[] = [
  {
    name: 'bakery-pos-2026-09-20.json',
    text: '{"format":"bakery-pos-backup"}',
    type: 'application/json',
  },
  { name: 'orders-2026-09-20.csv', text: 'Order,Time\r\n1,09:05\r\n', type: 'text/csv' },
]

/** See `useShareText.test.ts` — `navigator.share` is an accessor in a real browser. */
function installNavigatorApi(name: 'share' | 'canShare', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true })
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
  Reflect.deleteProperty(URL, 'createObjectURL')
  Reflect.deleteProperty(URL, 'revokeObjectURL')
  vi.restoreAllMocks()
})

function abortError(): Error {
  const error = new Error('Share canceled')
  error.name = 'AbortError'
  return error
}

/** Object URLs, as a browser would hand them out. */
function installObjectUrls(): {
  create: ReturnType<typeof vi.fn>
  revoke: ReturnType<typeof vi.fn>
} {
  let next = 0
  const create = vi.fn(() => `blob:pos/${next++}`)
  const revoke = vi.fn()
  Object.defineProperty(URL, 'createObjectURL', { value: create, configurable: true })
  Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true })
  return { create, revoke }
}

describe('useShareFiles — the share sheet', () => {
  it('calls navigator.share synchronously, with both files', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('canShare', vi.fn().mockReturnValue(true))

    const { result } = renderHook(() => useShareFiles())

    act(() => {
      result.current.share(FILES)
      // Inside the same turn as the tap, or the browser refuses the sheet.
      expect(share).toHaveBeenCalledTimes(1)
    })

    const shared = share.mock.calls[0][0] as { files: File[] }
    expect(shared.files.map((file) => file.name)).toEqual([
      'bakery-pos-2026-09-20.json',
      'orders-2026-09-20.csv',
    ])
    expect(shared.files[1].type).toBe('text/csv')
    await waitFor(() => expect(result.current.shared).toBe(true))
    expect(result.current.downloads).toEqual([])
  })

  it('treats a dismissed sheet as a cancel, with no fallback links', async () => {
    installNavigatorApi('share', vi.fn().mockRejectedValue(abortError()))
    installNavigatorApi('canShare', vi.fn().mockReturnValue(true))

    const { result } = renderHook(() => useShareFiles())
    await act(async () => {
      result.current.share(FILES)
    })

    expect(result.current.downloads).toEqual([])
    expect(result.current.shared).toBe(false)
  })

  it('falls back to download links when the sheet rejects for any other reason', async () => {
    installNavigatorApi('share', vi.fn().mockRejectedValue(new Error('no handler')))
    installNavigatorApi('canShare', vi.fn().mockReturnValue(true))
    installObjectUrls()

    const { result } = renderHook(() => useShareFiles())
    await act(async () => {
      result.current.share(FILES)
    })

    expect(result.current.downloads.map((link) => link.name)).toEqual([
      'bakery-pos-2026-09-20.json',
      'orders-2026-09-20.csv',
    ])
  })

  it('falls back when the browser says it cannot share files', async () => {
    const share = vi.fn()
    installNavigatorApi('share', share)
    installNavigatorApi('canShare', vi.fn().mockReturnValue(false))
    installObjectUrls()

    const { result } = renderHook(() => useShareFiles())
    act(() => {
      result.current.share(FILES)
    })

    // Never called: it would have rejected after the gesture was gone.
    expect(share).not.toHaveBeenCalled()
    expect(result.current.downloads).toHaveLength(2)
  })
})

describe('useShareFiles — the download fallback', () => {
  it('offers object URLs when the browser has them, and revokes them on unmount', async () => {
    const { create, revoke } = installObjectUrls()

    const { result, unmount } = renderHook(() => useShareFiles())
    act(() => {
      result.current.share(FILES)
    })

    expect(create).toHaveBeenCalledTimes(2)
    expect(result.current.downloads.map((link) => link.href)).toEqual(['blob:pos/0', 'blob:pos/1'])

    // A second export replaces the links, and the old URLs are released.
    act(() => {
      result.current.share(FILES)
    })
    expect(revoke).toHaveBeenCalledWith('blob:pos/0')

    unmount()
    expect(revoke).toHaveBeenCalledWith('blob:pos/2')
  })

  it('falls back to a data URL when object URLs are unavailable', () => {
    const { result } = renderHook(() => useShareFiles())

    act(() => {
      result.current.share([FILES[1]])
    })

    const [link] = result.current.downloads
    expect(link.name).toBe('orders-2026-09-20.csv')
    expect(link.href.startsWith('data:text/csv;charset=utf-8,')).toBe(true)
    expect(decodeURIComponent(link.href.split(',').slice(1).join(','))).toBe(FILES[1].text)
  })

  it('does nothing at all when handed no files', () => {
    const { result } = renderHook(() => useShareFiles())

    act(() => {
      result.current.share([])
    })

    expect(result.current.downloads).toEqual([])
  })
})
