import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import type { Product } from '../domain/types'
import { useCart } from '../hooks/useCart'
import { SellScreen } from './SellScreen'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

/** Renders SellScreen with a real useCart(), the way App.tsx does. */
function Harness({ db }: { db: PosDatabase }) {
  const cart = useCart()
  return <SellScreen cart={cart} database={db} />
}

/**
 * The cart bar and an in-stock tile can show the same formatted price
 * (e.g. both "฿55"), so total assertions target the bar specifically
 * rather than matching text anywhere on the screen.
 */
function cartBarTotalText(): string | null {
  return document.querySelector('.cart-bar-total')?.textContent ?? null
}

const fixtures: Product[] = [
  {
    id: 'p-croissant',
    name: 'Croissant',
    price: 5500,
    category: 'pastry',
    sortOrder: 1,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-cookie',
    name: 'Cookie',
    price: 4000,
    category: 'pastry',
    sortOrder: 2,
    outOfStock: true,
    archived: false,
  },
  {
    id: 'p-old-cake',
    name: 'Old Cake',
    price: 7500,
    category: 'cake',
    sortOrder: 3,
    outOfStock: false,
    archived: true,
  },
  {
    id: 'p-baguette',
    name: 'Baguette',
    price: 6000,
    category: 'bread',
    sortOrder: 4,
    outOfStock: false,
    archived: false,
  },
]

describe('SellScreen', () => {
  it('(a) tapping an in-stock tile updates the cart bar total and count', async () => {
    await database.products.bulkAdd(fixtures)
    render(<Harness db={database} />)

    const tile = await screen.findByRole('button', { name: /Croissant/ })
    expect(cartBarTotalText()).toBe('฿0')

    fireEvent.click(tile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿55'))
    expect(screen.getByText('1')).toBeInTheDocument()

    fireEvent.click(tile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿110'))
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('(b) an out-of-stock tile is disabled and tapping it leaves the total unchanged', async () => {
    await database.products.bulkAdd(fixtures)
    render(<Harness db={database} />)

    const cookieTile = await screen.findByRole('button', { name: /Cookie/ })
    expect(cookieTile).toBeDisabled()
    fireEvent.click(cookieTile)
    expect(cartBarTotalText()).toBe('฿0')
  })

  it('(c) an archived product is not rendered', async () => {
    await database.products.bulkAdd(fixtures)
    render(<Harness db={database} />)

    await screen.findByRole('button', { name: /Croissant/ })
    expect(screen.queryByText('Old Cake')).not.toBeInTheDocument()
  })

  it('(d) selecting a category tab hides products from other categories', async () => {
    await database.products.bulkAdd(fixtures)
    render(<Harness db={database} />)

    await screen.findByRole('button', { name: /Croissant/ })
    expect(screen.getByRole('button', { name: /Baguette/ })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('tab', { name: 'Bread' }))

    expect(screen.getByRole('button', { name: /Baguette/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Croissant/ })).not.toBeInTheDocument()
  })

  it('(e) never calls fetch', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('fetch should never be called on the checkout path')
    })
    await database.products.bulkAdd(fixtures)
    render(<Harness db={database} />)

    const tile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(tile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿55'))

    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('(f) bad data: invalid price/category/name products render without crashing, and good products still work', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badFixtures: Product[] = [
      ...fixtures,
      {
        id: 'p-bad-price',
        name: 'Bad Price Item',
        price: 55.5,
        category: 'drink',
        sortOrder: 5,
        outOfStock: false,
        archived: false,
      },
      {
        id: 'p-bad-category',
        name: 'Mystery Item',
        // Deliberately bad data: an unknown category value, cast past the
        // Category union the way a corrupted/hand-edited record would be.
        category: 'mystery' as unknown as Product['category'],
        price: 3000,
        sortOrder: 6,
        outOfStock: false,
        archived: false,
      },
      {
        id: 'p-bad-name',
        name: '',
        price: 2000,
        category: 'drink',
        sortOrder: 7,
        outOfStock: false,
        archived: false,
      },
    ]
    await database.products.bulkAdd(badFixtures)

    expect(() => render(<Harness db={database} />)).not.toThrow()

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(croissantTile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿55'))

    // The unknown-category product still shows under "All".
    expect(screen.getByText('Mystery Item')).toBeInTheDocument()

    // Bad price / bad name tiles are disabled and unavailable, not addable.
    const unavailableButtons = screen.getAllByText('Unavailable')
    expect(unavailableButtons.length).toBeGreaterThan(0)

    errorSpy.mockRestore()
  })

  it('shows a recoverable error state instead of crashing when the product query rejects', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badDatabase = {
      products: {
        orderBy: () => ({
          filter: () => ({
            toArray: () => Promise.reject(new Error('boom')),
          }),
        }),
      },
    } as unknown as PosDatabase

    expect(() => render(<Harness db={badDatabase} />)).not.toThrow()
    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()

    errorSpy.mockRestore()
  })

  it('shows a loading state before products resolve, and an empty state for no products', async () => {
    render(<Harness db={database} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(await screen.findByText(/no products/i)).toBeInTheDocument()
  })
})
