import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Product } from '../domain/types'
import { ProductTile } from './ProductTile'

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'pastry',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

describe('ProductTile', () => {
  it('calls onAdd once when an in-stock tile is tapped', () => {
    const onAdd = vi.fn()
    render(<ProductTile product={croissant} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: /Croissant/ }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(croissant)
  })

  it('shows the accessible name including product name and formatted price', () => {
    render(<ProductTile product={croissant} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toHaveAccessibleName(expect.stringContaining('฿55'))
  })

  it('an out-of-stock tile is disabled, shows "Sold out" and the price, and a click does not call onAdd', () => {
    const onAdd = vi.fn()
    render(<ProductTile product={{ ...croissant, outOfStock: true }} onAdd={onAdd} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Sold out')
    expect(button).toHaveTextContent('฿55')
    fireEvent.click(button)
    expect(onAdd).not.toHaveBeenCalled()
  })

  it('a product with a bad (non-integer) price renders disabled, without calling onAdd, and logs once', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onAdd = vi.fn()
    render(<ProductTile product={{ ...croissant, price: 55.5 }} onAdd={onAdd} />)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Unavailable')
    fireEvent.click(button)
    expect(onAdd).not.toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('a product with an empty name renders disabled without throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() =>
      render(<ProductTile product={{ ...croissant, name: '' }} onAdd={() => {}} />),
    ).not.toThrow()
    expect(screen.getByRole('button')).toBeDisabled()
    errorSpy.mockRestore()
  })

  it('a product with a negative price renders disabled without throwing and never calls formatBaht garbage into the DOM', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ProductTile product={{ ...croissant, price: -100 }} onAdd={() => {}} />)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveTextContent('Unavailable')
    errorSpy.mockRestore()
  })
})
