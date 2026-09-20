import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
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

function cartBarCountText(): string | null {
  return document.querySelector('.cart-bar-count')?.textContent ?? null
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
    expect(cartBarCountText()).toBe('1')

    fireEvent.click(tile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿110'))
    expect(cartBarCountText()).toBe('2')
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

  it('(f) bad data: every invalid product is skipped (never rendered), logged exactly once per id even across rerenders/taps, and good products still work with an exact total', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badFixtures: Product[] = [
      {
        id: 'p-bad-price',
        name: 'Bad Price',
        price: 55.5,
        category: 'drink',
        sortOrder: 10,
        outOfStock: false,
        archived: false,
      },
      {
        id: 'p-missing-price',
        name: 'Missing Price',
        // @ts-expect-error deliberately missing price
        price: undefined,
        category: 'drink',
        sortOrder: 11,
        outOfStock: false,
        archived: false,
      },
      {
        id: 'p-empty-name',
        name: '',
        price: 2000,
        category: 'drink',
        sortOrder: 12,
        outOfStock: false,
        archived: false,
      },
      {
        id: 'p-undefined-name',
        // @ts-expect-error deliberately missing name
        name: undefined,
        price: 2000,
        category: 'drink',
        sortOrder: 13,
        outOfStock: false,
        archived: false,
      },
      {
        id: 'p-string-archived',
        name: 'String Archived',
        price: 2000,
        category: 'drink',
        sortOrder: 14,
        outOfStock: false,
        // @ts-expect-error deliberately bad data
        archived: 'false',
      },
      {
        id: 'p-string-oos',
        name: 'String OOS',
        price: 2000,
        category: 'drink',
        sortOrder: 15,
        // @ts-expect-error deliberately bad data
        outOfStock: 'false',
        archived: false,
      },
      {
        id: 'p-undef-sort',
        name: 'Undef Sort',
        price: 2000,
        category: 'drink',
        // @ts-expect-error deliberately missing sortOrder
        sortOrder: undefined,
        outOfStock: false,
        archived: false,
      },
    ]
    await database.products.bulkAdd([...fixtures, ...badFixtures])

    expect(() => render(<Harness db={database} />)).not.toThrow()

    const croissantTile = await screen.findByRole('button', { name: /Croissant/ })

    // None of the invalid products render at all.
    expect(screen.queryByText('Bad Price')).not.toBeInTheDocument()
    expect(screen.queryByText('Missing Price')).not.toBeInTheDocument()
    expect(screen.queryByText('String Archived')).not.toBeInTheDocument()
    expect(screen.queryByText('String OOS')).not.toBeInTheDocument()
    expect(screen.queryByText('Undef Sort')).not.toBeInTheDocument()
    // Only the good, non-archived products' tiles exist (croissant, cookie,
    // baguette — "Old Cake" is archived and excluded regardless).
    expect(document.querySelectorAll('.tile').length).toBe(3)

    // No crash/fallback shown.
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()

    const badIds = [
      'p-bad-price',
      'p-missing-price',
      'p-empty-name',
      'p-undefined-name',
      'p-string-archived',
      'p-string-oos',
      'p-undef-sort',
    ]
    const countLogsFor = (id: string) =>
      errorSpy.mock.calls.filter((args) => typeof args[0] === 'string' && args[0].includes(id))
        .length

    // The tile resolving only means the grid committed; `useLogInvalidOnce`
    // logs from an effect, which React may flush in a later task. Wait for it
    // rather than asserting immediately, or this races (~2-3% of runs).
    await waitFor(() => {
      for (const id of badIds) {
        expect(countLogsFor(id)).toBe(1)
      }
    })

    // Good products still add, and the total stays exact through a rerender
    // (tab switch) and a few taps — and logging does not repeat.
    fireEvent.click(screen.getByRole('tab', { name: 'Pastry' }))
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    fireEvent.click(croissantTile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿55'))
    fireEvent.click(croissantTile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿110'))

    for (const id of badIds) {
      expect(countLogsFor(id)).toBe(1)
    }

    errorSpy.mockRestore()
  })

  it('the cart bar stays visible with its total when the product query rejects, and "Try again" recovers once it succeeds', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    let calls = 0
    const flakyDatabase = {
      products: {
        toArray: () => {
          calls++
          return calls === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(fixtures)
        },
      },
    } as unknown as PosDatabase

    expect(() => render(<Harness db={flakyDatabase} />)).not.toThrow()

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
    // The cart bar (a sibling of the failed grid, not inside its boundary)
    // is still present with its total.
    expect(cartBarTotalText()).toBe('฿0')

    fireEvent.click(screen.getByRole('button', { name: /try again/i }))

    expect(await screen.findByRole('button', { name: /Croissant/ })).toBeInTheDocument()
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument()
    expect(cartBarTotalText()).toBe('฿0')

    errorSpy.mockRestore()
  })

  it('shows a loading state before products resolve, an empty state for no products, and keeps the cart bar visible throughout', async () => {
    render(<Harness db={database} />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
    expect(cartBarTotalText()).toBe('฿0')

    expect(await screen.findByText(/no products/i)).toBeInTheDocument()
    expect(cartBarTotalText()).toBe('฿0')
  })

  it('regression: falls back to "All" (grid and aria-selected) when the selected category\'s last product goes out of scope live', async () => {
    const bananaCake: Product = {
      id: 'p-banana-cake',
      name: 'Banana Cake',
      price: 7500,
      category: 'cake',
      sortOrder: 5,
      outOfStock: false,
      archived: false,
    }
    await database.products.bulkAdd([...fixtures, bananaCake])
    render(<Harness db={database} />)

    await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(screen.getByRole('tab', { name: 'Cake' }))
    expect(await screen.findByRole('button', { name: /Banana Cake/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Cake' })).toHaveAttribute('aria-selected', 'true')

    await database.products.update('p-banana-cake', { archived: true })

    await waitFor(() => {
      expect(screen.queryByRole('tab', { name: 'Cake' })).not.toBeInTheDocument()
    })
    expect(screen.getByRole('tab', { name: 'All' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('button', { name: /Croissant/ })).toBeInTheDocument()
  })

  it('regression: a product added to the db while the screen is open appears live', async () => {
    await database.products.bulkAdd(fixtures)
    render(<Harness db={database} />)
    await screen.findByRole('button', { name: /Croissant/ })
    expect(screen.queryByRole('button', { name: /New Item/ })).not.toBeInTheDocument()

    await database.products.add({
      id: 'p-new',
      name: 'New Item',
      price: 3000,
      category: 'drink',
      sortOrder: 20,
      outOfStock: false,
      archived: false,
    })

    expect(await screen.findByRole('button', { name: /New Item/ })).toBeInTheDocument()
  })

  it('regression: inside StrictMode, one click adds exactly 1', async () => {
    await database.products.bulkAdd(fixtures)
    render(
      <StrictMode>
        <Harness db={database} />
      </StrictMode>,
    )
    const tile = await screen.findByRole('button', { name: /Croissant/ })
    fireEvent.click(tile)
    await waitFor(() => expect(cartBarTotalText()).toBe('฿55'))
    expect(cartBarCountText()).toBe('1')
  })

  it('regression: a large total (999,999,900 satang x 50) stays an exact integer and formats correctly', async () => {
    const expensive: Product = {
      id: 'p-expensive',
      name: 'Expensive Cake',
      price: 999_999_900,
      category: 'cake',
      sortOrder: 1,
      outOfStock: false,
      archived: false,
    }
    await database.products.add(expensive)
    render(<Harness db={database} />)

    const tile = await screen.findByRole('button', { name: /Expensive Cake/ })
    for (let i = 0; i < 50; i++) fireEvent.click(tile)

    await waitFor(() => expect(cartBarCountText()).toBe('50'))
    // 999,999,900 satang * 50 = 49,999,995,000 satang = ฿499,999,950.
    expect(cartBarTotalText()).toBe('฿499,999,950')
  })
})
