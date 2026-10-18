import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Product, ProductImage } from '../domain/types'
import { ProductTile } from './ProductTile'

// One shipped picture, for the repo-file fallback. `p-croissant` is
// deliberately absent, so every other test here runs with no shipped
// picture — the normal state.
vi.mock('../images/repoImages', () => ({
  REPO_PRODUCT_IMAGE_FILES: { 'p-shipped': 'p-shipped.webp', 'p-upper': 'p-upper.PNG' },
}))

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'cookies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

function photo(): ProductImage {
  const blob = new Blob([new Uint8Array(2048)], { type: 'image/webp' })
  return { blob, type: 'image/webp', width: 512, height: 384 }
}

const originalCreate = URL.createObjectURL
const originalRevoke = URL.revokeObjectURL

beforeEach(() => {
  URL.createObjectURL = () => 'blob:tile-photo'
  URL.revokeObjectURL = () => {}
})

afterEach(() => {
  URL.createObjectURL = originalCreate
  URL.revokeObjectURL = originalRevoke
})

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
    const { container } = render(
      <ProductTile product={{ ...croissant, name: '' }} onAdd={() => {}} />,
    )
    expect(() => container).not.toThrow()
    expect(container).toBeEmptyDOMElement()
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it('renders nothing for a negative price, and it is never addable', () => {
    const onAdd = vi.fn()
    const { container } = render(
      <ProductTile product={{ ...croissant, price: -100 }} onAdd={onAdd} />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(onAdd).not.toHaveBeenCalled()
  })
})

describe('ProductTile stock', () => {
  it('shows "Stock: 5" under the price for a tracked product', () => {
    render(<ProductTile product={{ ...croissant, stock: 5 }} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    const label = button.querySelector('.tile-stock')
    expect(label).toHaveTextContent('Stock: 5')
    expect(label).not.toHaveClass('tile-stock-low')
    // Under the price: it comes after the <strong> in the tile.
    expect(button.querySelector('strong + .tile-stock')).toBe(label)
  })

  it('keeps the name unchanged and reads the count as the description', () => {
    render(<ProductTile product={{ ...croissant, stock: 5 }} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toHaveAccessibleName('Croissant ฿55')
    expect(button).toHaveAccessibleDescription('Stock: 5')
  })

  it('shows nothing for an untracked product', () => {
    render(<ProductTile product={croissant} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button.querySelector('.tile-stock')).toBeNull()
    expect(button).not.toHaveTextContent('Stock')
    // Named from its content exactly as before stock existed.
    expect(button).not.toHaveAttribute('aria-labelledby')
    expect(button).not.toHaveAttribute('aria-describedby')
  })

  it.each([0, -3])('marks %i as low, and the tile stays tappable', (level) => {
    const onAdd = vi.fn()
    render(<ProductTile product={{ ...croissant, stock: level }} onAdd={onAdd} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    const label = button.querySelector('.tile-stock')
    expect(label).toHaveTextContent(`Stock: ${level}`)
    expect(label).toHaveClass('tile-stock-low')
    expect(button).toBeEnabled()
    expect(button).not.toHaveClass('tile-disabled')
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('shows the count on a Sold-out tile too, which keeps "Sold out" in its name', () => {
    render(<ProductTile product={{ ...croissant, stock: 4, outOfStock: true }} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toBeDisabled()
    expect(button.querySelector('.tile-stock')).toHaveTextContent('Stock: 4')
    expect(button).toHaveAccessibleName('Croissant ฿55 Sold out')
    expect(button).toHaveAccessibleDescription('Stock: 4')
  })

  it.each([
    ['NaN', Number.NaN],
    ['1.5', 1.5],
    ["'5'", '5'],
    ['1e300', 1e300],
    ['null', null],
  ])('renders a corrupt count (%s) as untracked, stays sellable, and never logs', (_, stock) => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onAdd = vi.fn()
    render(
      <ProductTile product={{ ...croissant, stock: stock as unknown as number }} onAdd={onAdd} />,
    )
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button.querySelector('.tile-stock')).toBeNull()
    expect(button).not.toHaveAttribute('aria-describedby')
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledTimes(1)
    // SellScreen logs it once; the tile stays silent.
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})

describe('ProductTile pictures', () => {
  it('renders no <img> at all for a product with no picture — the normal state', () => {
    const { container } = render(<ProductTile product={croissant} onAdd={() => {}} />)
    expect(container.querySelector('img')).toBeNull()
    // Exactly today's look: name and price, nothing else.
    expect(screen.getByRole('button', { name: /Croissant/ })).toHaveTextContent('฿55')
  })

  it('shows the photo stored on the device', () => {
    const { container } = render(
      <ProductTile product={{ ...croissant, image: photo() }} onAdd={() => {}} />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('src', 'blob:tile-photo')
  })

  it('shows the picture shipped in the repo when there is no device photo', () => {
    const { container } = render(
      <ProductTile product={{ ...croissant, id: 'p-shipped' }} onAdd={() => {}} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', '/products/p-shipped.webp')
  })

  it('serves a shipped picture whose extension is upper-case with its exact file name', () => {
    const { container } = render(
      <ProductTile product={{ ...croissant, id: 'p-upper' }} onAdd={() => {}} />,
    )
    expect(container.querySelector('img')).toHaveAttribute('src', '/products/p-upper.PNG')
  })

  it('a shipped picture that fails to load (404) is dropped and the tile is still tappable', () => {
    const onAdd = vi.fn()
    const { container } = render(
      <ProductTile product={{ ...croissant, id: 'p-shipped' }} onAdd={onAdd} />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    if (img === null) return
    fireEvent.error(img)
    expect(container.querySelector('img')).toBeNull()
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toHaveTextContent('฿55')
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('falls back to the shipped picture when the device photo fails, then to text when that fails too', () => {
    const { container } = render(
      <ProductTile product={{ ...croissant, id: 'p-shipped', image: photo() }} onAdd={() => {}} />,
    )
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toHaveAttribute('src', '/products/p-shipped.webp')
    fireEvent.error(container.querySelector('img') as HTMLImageElement)
    expect(container.querySelector('img')).toBeNull()
  })

  it('keeps the name and the price legible alongside a picture', () => {
    render(<ProductTile product={{ ...croissant, image: photo() }} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toHaveTextContent('Croissant')
    expect(button).toHaveTextContent('฿55')
  })

  it('leaves the accessible name as the product name and price — the picture adds nothing to it', () => {
    render(<ProductTile product={{ ...croissant, image: photo() }} onAdd={() => {}} />)
    const button = screen.getByRole('button', { name: /Croissant/ })
    // alt="" on purpose: a picture must not make a screen reader say the
    // product name twice.
    expect(button.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('is still tappable with a picture on it, and adds the product once', () => {
    const onAdd = vi.fn()
    const product = { ...croissant, image: photo() }
    render(<ProductTile product={product} onAdd={onAdd} />)
    fireEvent.click(screen.getByRole('button', { name: /Croissant/ }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(onAdd).toHaveBeenCalledWith(product)
  })

  it('keeps the greying and the "Sold out" label on top of a picture', () => {
    render(
      <ProductTile product={{ ...croissant, image: photo(), outOfStock: true }} onAdd={() => {}} />,
    )
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toBeDisabled()
    expect(button).toHaveClass('tile-disabled')
    expect(button).toHaveTextContent('Sold out')
    expect(button.querySelector('img')).not.toBeNull()
  })

  it('drops the picture and keeps the tile sellable when the photo will not decode', () => {
    const onAdd = vi.fn()
    const { container } = render(
      <ProductTile product={{ ...croissant, image: photo() }} onAdd={onAdd} />,
    )
    const img = container.querySelector('img')
    expect(img).not.toBeNull()
    if (img === null) return
    fireEvent.error(img)

    expect(container.querySelector('img')).toBeNull()
    const button = screen.getByRole('button', { name: /Croissant/ })
    expect(button).toHaveTextContent('฿55')
    fireEvent.click(button)
    expect(onAdd).toHaveBeenCalledTimes(1)
  })

  it('ignores a corrupt stored picture, logs it once, and stays sellable', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onAdd = vi.fn()
    const product = { ...croissant, image: { blob: 'not a blob' } as unknown as ProductImage }
    const { container } = render(<ProductTile product={product} onAdd={onAdd} />)

    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Croissant/ }))
    expect(onAdd).toHaveBeenCalledTimes(1)
    expect(errorSpy).toHaveBeenCalledTimes(1)
    errorSpy.mockRestore()
  })

  it('never looks at a picture for a product it refuses to render', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { container } = render(
      <ProductTile
        product={{ ...croissant, price: 55.5, image: { blob: 'bad' } as unknown as ProductImage }}
        onAdd={() => {}}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    // The caller logs the invalid product; the tile stays silent.
    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
