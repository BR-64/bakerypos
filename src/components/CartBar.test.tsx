import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CartBar } from './CartBar'

describe('CartBar', () => {
  it('shows the count and formatted total', () => {
    render(<CartBar count={2} total={11000} onOpen={() => {}} />)
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByText('฿110')).toBeInTheDocument()
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
})
