import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { SCREEN_TITLES, type Screen } from '../navigation'
import { PlaceholderScreen } from './PlaceholderScreen'

const placeholderScreens: Screen[] = ['cash', 'promptpay', 'orders', 'report', 'admin']

describe('PlaceholderScreen', () => {
  it.each(placeholderScreens)('shows the %s title and "Coming soon"', (s) => {
    render(<PlaceholderScreen title={SCREEN_TITLES[s]} navigate={() => {}} />)
    expect(screen.getByRole('heading', { name: SCREEN_TITLES[s] })).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
  })

  it.each(placeholderScreens)('Back to Sell calls navigate("sell") exactly once for %s', (s) => {
    const navigate = vi.fn()
    render(<PlaceholderScreen title={SCREEN_TITLES[s]} navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: /back to sell/i }))
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('sell')
  })
})
