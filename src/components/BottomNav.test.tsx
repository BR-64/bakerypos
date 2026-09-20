import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { BottomNav } from './BottomNav'

describe('BottomNav', () => {
  it('renders Sell, Orders, Report and Admin, in that order', () => {
    render(<BottomNav screen="sell" navigate={() => {}} />)
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((b) => b.textContent)).toEqual(['Sell', 'Orders', 'Report', 'Admin'])
  })

  it('marks the current screen with aria-current="page", others unset', () => {
    render(<BottomNav screen="orders" navigate={() => {}} />)
    expect(screen.getByRole('button', { name: 'Orders' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('button', { name: 'Sell' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Report' })).not.toHaveAttribute('aria-current')
    expect(screen.getByRole('button', { name: 'Admin' })).not.toHaveAttribute('aria-current')
  })

  it('tapping a tab navigates to that screen', () => {
    const navigate = vi.fn()
    render(<BottomNav screen="sell" navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Report' }))
    expect(navigate).toHaveBeenCalledWith('report')
  })

  it('is usable (still renders and navigates) even when passed a screen outside NAV_SCREENS', () => {
    // Defensive: App never renders BottomNav on cart/cash/promptpay, but the
    // component itself must not crash or mis-highlight if it ever were.
    const navigate = vi.fn()
    render(<BottomNav screen="cart" navigate={navigate} />)
    for (const name of ['Sell', 'Orders', 'Report', 'Admin']) {
      expect(screen.getByRole('button', { name })).not.toHaveAttribute('aria-current')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Admin' }))
    expect(navigate).toHaveBeenCalledWith('admin')
  })
})
