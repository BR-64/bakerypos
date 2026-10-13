import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Product } from '../domain/types'
import { ProductTile } from './ProductTile'

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'cookies',
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

  it('treats a non-boolean outOfStock strictly: only === true is out of stock', () => {
    const onAdd = vi.fn()
    // @ts-expect-error deliberately bad data — this is invalid, so it
    // should not render at all (see the "renders nothing" tests below),
    // but if isSellable's contract ever loosened, this pins that a
    // non-boolean outOfStock must never be read as "in stock and tappable"
    // by truthiness alone.
    render(<ProductTile product={{ ...croissant, outOfStock: 'false' }} onAdd={onAdd} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('renders nothing (not "Unavailable") for a bad (non-integer) price, and never logs', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onAdd = vi.fn()
    const { container } = render(
      <ProductTile product={{ ...croissant, price: 55.5 }} onAdd={onAdd} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('renders nothing for an empty name, without throwing or logging', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(<ProductTile product={{ ...croissant, name: '' }} onAdd={() => {}} />)
    expect(() => container).not.toThrow()
    expect(container).toBeEmptyDOMElement()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('renders nothing for a negative price, and it is never addable', () => {
    const onAdd = vi.fn()
    const { container } = render(<ProductTile product={{ ...croissant, price: -100 }} onAdd={onAdd} />)
    expect(container).toBeEmptyDOMElement()
    expect(onAdd).not.toHaveBeenCalled()
  })
})
