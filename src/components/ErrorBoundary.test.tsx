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

  it('shows a fallback with a Reload button when a child throws, and no Try again button without onRetry', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument()
    errorSpy.mockRestore()
  })

  it('shows a Try again button when onRetry is given, and calls it on tap', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onRetry = vi.fn()
    render(
      <ErrorBoundary onRetry={onRetry}>
        <Bomb />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(onRetry).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('shows no Back to Sell button when onBack is not given', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    )
    expect(screen.queryByRole('button', { name: /back to sell/i })).not.toBeInTheDocument()
    errorSpy.mockRestore()
  })

  it('shows a Back to Sell button when onBack is given, and calls it once on tap', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onBack = vi.fn()
    render(
      <ErrorBoundary onBack={onBack}>
        <Bomb />
      </ErrorBoundary>,
    )
    fireEvent.click(screen.getByRole('button', { name: /back to sell/i }))
    expect(onBack).toHaveBeenCalledTimes(1)
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
