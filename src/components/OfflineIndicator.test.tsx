import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OFFLINE_LABEL, OfflineIndicator } from './OfflineIndicator'

function setOnLine(value: boolean): void {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => value })
}

afterEach(() => {
  // @ts-expect-error — removing the override restores jsdom's own getter.
  delete navigator.onLine
})

describe('OfflineIndicator', () => {
  it('shows nothing while the device is online', () => {
    setOnLine(true)

    render(<OfflineIndicator />)

    expect(screen.queryByText(OFFLINE_LABEL)).not.toBeInTheDocument()
  })

  it('appears on the offline event and goes away again on online', () => {
    setOnLine(true)
    render(<OfflineIndicator />)

    act(() => {
      setOnLine(false)
      window.dispatchEvent(new Event('offline'))
    })
    expect(screen.getByText(OFFLINE_LABEL)).toBeInTheDocument()

    act(() => {
      setOnLine(true)
      window.dispatchEvent(new Event('online'))
    })
    expect(screen.queryByText(OFFLINE_LABEL)).not.toBeInTheDocument()
  })

  it('announces itself, and never asks the network whether it is online', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('the offline indicator must never touch the network')
    })
    setOnLine(false)

    render(<OfflineIndicator />)

    // A polite live region, not role="status" — App's order toast owns that
    // role, and the badge must not compete with it.
    expect(screen.getByText(OFFLINE_LABEL).parentElement).toHaveAttribute('aria-live', 'polite')
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })
})
