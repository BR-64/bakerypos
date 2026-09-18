import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { safeString } from '../domain/log'
import { useLogInvalidOnce } from './useLogInvalidOnce'

describe('useLogInvalidOnce', () => {
  it('logs each item once, keyed by keyOf, even across rerenders with fresh arrays', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const items = [{ id: 'a' }, { id: 'b' }]

    const { rerender } = renderHook(
      ({ invalid }: { invalid: { id: string }[] }) =>
        useLogInvalidOnce(
          invalid,
          (i) => i.id,
          (i) => `bad ${i.id}`,
        ),
      { initialProps: { invalid: items } },
    )
    expect(errorSpy).toHaveBeenCalledTimes(2)
    expect(errorSpy).toHaveBeenCalledWith('bad a')
    expect(errorSpy).toHaveBeenCalledWith('bad b')

    // A fresh array with the same keys (as partitionSellable/partitionCartLines
    // return on every call) must not log again.
    rerender({ invalid: [{ id: 'a' }, { id: 'b' }] })
    rerender({ invalid: [{ id: 'a' }, { id: 'b' }] })
    expect(errorSpy).toHaveBeenCalledTimes(2)

    // A new key is logged once, existing keys stay deduped.
    rerender({ invalid: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] })
    expect(errorSpy).toHaveBeenCalledTimes(3)
    expect(errorSpy).toHaveBeenCalledWith('bad c')

    errorSpy.mockRestore()
  })

  it('never throws building a key or message for a circular object', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const circular: Record<string, unknown> = { name: 'oops' }
    circular.self = circular

    expect(() =>
      renderHook(() =>
        useLogInvalidOnce(
          [circular],
          (item) => safeString(item),
          (item) => `bad ${safeString(item)}`,
        ),
      ),
    ).not.toThrow()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('[unserializable value]')

    errorSpy.mockRestore()
  })

  it('never throws building a key or message for a value containing a BigInt', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const withBigInt = { big: 10n }

    expect(() =>
      renderHook(() =>
        useLogInvalidOnce(
          [withBigInt],
          (item) => safeString(item),
          (item) => `bad ${safeString(item)}`,
        ),
      ),
    ).not.toThrow()
    expect(errorSpy).toHaveBeenCalledTimes(1)
    expect(errorSpy.mock.calls[0][0]).toContain('10n')

    errorSpy.mockRestore()
  })

  it('logs nothing for an empty invalid array', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    renderHook(() =>
      useLogInvalidOnce(
        [],
        (i: never) => safeString(i),
        (i: never) => safeString(i),
      ),
    )
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
