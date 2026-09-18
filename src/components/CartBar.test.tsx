import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CartBar } from './CartBar'

describe('CartBar', () => {
  it('shows the count and formatted total', () => {
    render(<CartBar count={2} total={11000} onOpen={() => {}} />)
    expect(document.querySelector('.cart-bar-count')).toHaveTextContent('2')
    expect(document.querySelector('.cart-bar-total')).toHaveTextContent('฿110')
  })

  it('has a descriptive aria-label', () => {
    render(<CartBar count={2} total={11000} onOpen={() => {}} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Cart: 2 items, ฿110')
  })

  it('singularizes the aria-label for exactly one item', () => {
    render(<CartBar count={1} total={5500} onOpen={() => {}} />)
    expect(screen.getByRole('button')).toHaveAccessibleName('Cart: 1 item, ฿55')
  })

  it('calls onOpen once when tapped', () => {
    const onOpen = vi.fn()
    render(<CartBar count={2} total={11000} onOpen={onOpen} />)
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('is disabled when count is 0', () => {
    render(<CartBar count={0} total={0} onOpen={() => {}} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('is disabled when onOpen is not provided', () => {
    render(<CartBar count={2} total={11000} />)
    expect(screen.getByRole('button')).toBeDisabled()
  })

  it('regression: an empty cart with onOpenCart provided still shows a disabled bar at 0 / ฿0', () => {
    render(<CartBar count={0} total={0} onOpen={() => {}} />)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(document.querySelector('.cart-bar-count')).toHaveTextContent('0')
    expect(document.querySelector('.cart-bar-total')).toHaveTextContent('฿0')
  })
})
