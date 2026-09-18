import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from './ErrorBoundary'

function Bomb(): never {
  throw new Error('boom')
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>All good</p>
      </ErrorBoundary>,
    )
    expect(screen.getByText('All good')).toBeInTheDocument()
  })

  it('shows a fallback with a Reload button when a child throws', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    errorSpy.mockRestore()
  })

  it('the Reload button calls location.reload()', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // jsdom's window.location.reload is non-configurable, so it can't be
    // spied on directly — replace the whole location object instead.
    const originalLocation = window.location
    const reloadMock = vi.fn()
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, reload: reloadMock },
    })

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: /reload/i }))
    expect(reloadMock).toHaveBeenCalledTimes(1)

    Object.defineProperty(window, 'location', { configurable: true, value: originalLocation })
    errorSpy.mockRestore()
  })
})
