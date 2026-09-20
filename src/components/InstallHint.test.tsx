import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { INSTALL_HINT_DISMISSED_KEY } from '../hooks/useInstallHint'
import { InstallHint } from './InstallHint'

/** jsdom's `matchMedia` answers `false` to everything — i.e. a browser tab. */
const realMatchMedia = window.matchMedia

function pretendStandalone(): void {
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('standalone'),
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

describe('InstallHint', () => {
  it('offers "Add to Home screen" in a browser tab', () => {
    render(<InstallHint />)

    expect(screen.getByText(/Add to Home screen/)).toBeInTheDocument()
  })

  it('renders nothing at all once the app is installed', () => {
    pretendStandalone()

    const { container } = render(<InstallHint />)

    expect(screen.queryByText(/Add to Home screen/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Got it' })).not.toBeInTheDocument()
    // Not merely hidden: nothing of it reaches the DOM, so it can't take
    // up space above the screen in an installed window.
    expect(container).toBeEmptyDOMElement()
  })

  it('goes away when dismissed, with a touch target big enough to hit', () => {
    render(<InstallHint />)
    const dismiss = screen.getByRole('button', { name: 'Got it' })

    // The 48px rule lives in CSS (`min-height: var(--tap)`), which jsdom
    // doesn't compute; assert the class that carries it is there.
    expect(dismiss).toHaveClass('install-hint-dismiss')
    fireEvent.click(dismiss)

    expect(screen.queryByText(/Add to Home screen/)).not.toBeInTheDocument()
    expect(window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY)).toBe('1')
  })
})
