import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { useLiveQuery } from 'dexie-react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { completeOrder, voidOrder } from '../db/orders'
import { receiveStock, setStockCount } from '../db/stock'
import { formatLocalTime, localDayKey } from '../domain/day'
import type { Product, StockMovement } from '../domain/types'
import { StockControls } from './StockControls'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const brownie: Product = {
  id: 'p-brownie',
  name: 'Brownie',
  price: 30000,
  category: 'brownies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

/** Feeds the live row, the way Admin's product list does. */
function Live({ id }: { id: string }) {
  const product = useLiveQuery(() => database.products.get(id), [id])
  if (product === undefined) return null
  return <StockControls product={product} database={database} />
}

async function renderLive(product: Product = brownie) {
  await database.products.put(product)
  render(<Live id={product.id} />)
  await screen.findByRole('button', { name: `Set count for ${product.name}` })
}

function setCount(value: string, name = 'Brownie'): void {
  fireEvent.click(screen.getByRole('button', { name: `Set count for ${name}` }))
  fireEvent.change(screen.getByLabelText(`New count for ${name}`), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

describe('StockControls — status', () => {
  it('says "Not tracked" for a product without a count, and hides "+ Received"', async () => {
    await renderLive()
    expect(screen.getByText('Not tracked')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Received for Brownie' })).not.toBeInTheDocument()
  })

  it('shows the count for a tracked product, including zero and below', async () => {
    await renderLive({ ...brownie, stock: -2 })
    expect(screen.getByText('Stock: -2')).toHaveClass('stock-status-low')
    expect(screen.getByRole('button', { name: '+ Received for Brownie' })).toBeInTheDocument()
  })

  it('says an unreadable count needs setting, without crashing or offering "+ Received"', async () => {
    await renderLive({ ...brownie, stock: 'abc' as unknown as number })
    expect(screen.getByText('Stock unreadable — set a count')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '+ Received for Brownie' })).not.toBeInTheDocument()
  })

  it('every control is a real button with the 48px admin class', async () => {
    await renderLive({ ...brownie, stock: 3 })
    for (const name of ['Set count for Brownie', '+ Received for Brownie', 'History for Brownie']) {
      expect(screen.getByRole('button', { name })).toHaveClass('admin-secondary-button')
    }
    fireEvent.click(screen.getByRole('button', { name: 'Set count for Brownie' }))
    expect(screen.getByLabelText('New count for Brownie')).toHaveClass('admin-input')
    expect(screen.getByRole('button', { name: 'Save' })).toHaveClass('admin-primary-button')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveClass('admin-secondary-button')
  })
})

describe('StockControls — Set count', () => {
  it('starts tracking with a numeric input, then offers "+ Received"', async () => {
    await renderLive()

    fireEvent.click(screen.getByRole('button', { name: 'Set count for Brownie' }))
    const input = screen.getByLabelText('New count for Brownie')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    fireEvent.change(input, { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Stock: 5')).toBeInTheDocument()
    expect(screen.queryByLabelText('New count for Brownie')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '+ Received for Brownie' })).toBeInTheDocument()
    expect((await database.products.get('p-brownie'))?.stock).toBe(5)
    expect(await database.stockMovements.count()).toBe(1)
  })

  it('refuses a bad count inline and writes nothing', async () => {
    await renderLive()

    for (const bad of ['', '-1', '1.5', '100001', 'abc']) {
      fireEvent.click(screen.getByRole('button', { name: 'Set count for Brownie' }))
      fireEvent.change(screen.getByLabelText('New count for Brownie'), { target: { value: bad } })
      fireEvent.click(screen.getByRole('button', { name: 'Save' }))
      expect(await screen.findByRole('alert')).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    }

    expect((await database.products.get('p-brownie'))?.stock).toBeUndefined()
    expect(await database.stockMovements.count()).toBe(0)
  })

  it('Cancel closes the input and writes nothing', async () => {
    await renderLive()
    fireEvent.click(screen.getByRole('button', { name: 'Set count for Brownie' }))
    fireEvent.change(screen.getByLabelText('New count for Brownie'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByLabelText('New count for Brownie')).not.toBeInTheDocument()
    expect(await database.stockMovements.count()).toBe(0)
  })

  it('repairs an unreadable count', async () => {
    await renderLive({ ...brownie, stock: 'abc' as unknown as number })
    setCount('4')
    expect(await screen.findByText('Stock: 4')).toBeInTheDocument()
    expect((await database.products.get('p-brownie'))?.stock).toBe(4)
  })

  it('disables Save while the write is pending, and a double tap writes once', async () => {
    await renderLive()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Held *before* the transaction starts — awaiting a non-Dexie promise
    // inside one would let IndexedDB auto-commit it.
    const realTransaction = database.transaction.bind(database) as (
      ...args: unknown[]
    ) => Promise<unknown>
    const transaction = vi.spyOn(database, 'transaction').mockImplementation((async (
      ...args: unknown[]
    ) => {
      await gate
      return realTransaction(...args)
    }) as unknown as typeof database.transaction)

    fireEvent.click(screen.getByRole('button', { name: 'Set count for Brownie' }))
    fireEvent.change(screen.getByLabelText('New count for Brownie'), { target: { value: '5' } })
    const save = screen.getByRole('button', { name: 'Save' })
    fireEvent.click(save)
    fireEvent.click(save)

    await waitFor(() => expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled())
    expect(screen.getByLabelText('New count for Brownie')).toBeDisabled()
    release()

    expect(await screen.findByText('Stock: 5')).toBeInTheDocument()
    expect(transaction).toHaveBeenCalledTimes(1)
    expect(await database.stockMovements.count()).toBe(1)
  })

  it('shows a rejected write inline and keeps the input open to retry', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderLive()
    vi.spyOn(database.stockMovements, 'add').mockRejectedValueOnce(new Error('disk full'))

    setCount('5')

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(screen.getByLabelText('New count for Brownie')).toHaveValue('5')
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
    // The transaction rolled back: no half-written count.
    expect((await database.products.get('p-brownie'))?.stock).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Stock: 5')).toBeInTheDocument()
  })
})

describe('StockControls — + Received', () => {
  it('adds a delivery to the count', async () => {
    await renderLive({ ...brownie, stock: 2 })

    fireEvent.click(screen.getByRole('button', { name: '+ Received for Brownie' }))
    const input = screen.getByLabelText('How many Brownie arrived')
    expect(input).toHaveAttribute('inputmode', 'numeric')
    fireEvent.change(input, { target: { value: '10' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByText('Stock: 12')).toBeInTheDocument()
    const [movement] = await database.stockMovements.toArray()
    expect(movement).toMatchObject({ kind: 'received', delta: 10, level: 12, previous: 2 })
  })

  it('refuses zero inline', async () => {
    await renderLive({ ...brownie, stock: 2 })
    fireEvent.click(screen.getByRole('button', { name: '+ Received for Brownie' }))
    fireEvent.change(screen.getByLabelText('How many Brownie arrived'), {
      target: { value: '0' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('at least 1')
    expect(await database.stockMovements.count()).toBe(0)
  })
})

describe('StockControls — history', () => {
  it('lists movements newest first with date and time, kind, signed delta and level', async () => {
    // Only `Date` is faked (Dexie and fake-indexeddb keep their real
    // timers), so each step gets its own distinct local time.
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const at = (minute: number) => vi.setSystemTime(new Date(2026, 9, 18, 9, minute))
      await database.products.put(brownie)
      at(0)
      await setStockCount('p-brownie', 5, database)
      at(10)
      const order = await completeOrder(
        [{ productId: 'p-brownie', name: 'Brownie', unitPrice: 30000, qty: 2 }],
        { method: 'cash', tendered: 60000, change: 0 },
        database,
      )
      at(20)
      await voidOrder(order.id, 'Duplicate order', database)
      at(30)
      await receiveStock('p-brownie', 3, database)
    } finally {
      vi.useRealTimers()
    }
    render(<Live id="p-brownie" />)

    const toggle = await screen.findByRole('button', { name: 'History for Brownie' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const list = await screen.findByRole('list', { name: 'Stock history' })
    const rows = within(list).getAllByRole('listitem')
    const day = localDayKey(new Date(2026, 9, 18))
    expect(day).toBe('2026-10-18')
    expect(
      rows.map((row) =>
        [...row.querySelectorAll('span')].map((span) => span.textContent).join(' | '),
      ),
    ).toEqual([
      `${day} 09:30 | Received | +3 | now 8`,
      `${day} 09:20 | Void #1 | +2 | now 5`,
      `${day} 09:10 | Sale #1 | -2 | now 3`,
      `${day} 09:00 | Count | +5 | now 5`,
    ])
    expect(formatLocalTime(new Date(2026, 9, 18, 9, 30).toISOString())).toBe('09:30')

    fireEvent.click(toggle)
    expect(screen.queryByRole('list', { name: 'Stock history' })).not.toBeInTheDocument()
  })

  it('updates live when the count changes while open', async () => {
    await renderLive()
    fireEvent.click(screen.getByRole('button', { name: 'History for Brownie' }))
    expect(await screen.findByText('No stock changes yet.')).toBeInTheDocument()

    setCount('6')

    const list = await screen.findByRole('list', { name: 'Stock history' })
    expect(within(list).getByText('Count')).toBeInTheDocument()
    expect(within(list).getByText('+6')).toBeInTheDocument()
  })

  it('skips a corrupt movement, logs it once, and counts it in the footer', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.products.put(brownie)
    await setStockCount('p-brownie', 5, database)
    const corrupt = {
      id: 'm-corrupt',
      productId: 'p-brownie',
      kind: 'set',
      delta: 'lots',
      level: 5,
      previous: null,
      createdAt: new Date().toISOString(),
    } as unknown as StockMovement
    await database.stockMovements.add(corrupt)
    render(<Live id="p-brownie" />)

    fireEvent.click(await screen.findByRole('button', { name: 'History for Brownie' }))
    const list = await screen.findByRole('list', { name: 'Stock history' })
    expect(within(list).getAllByRole('listitem')).toHaveLength(1)
    expect(screen.getByText('1 entry couldn’t be displayed.')).toBeInTheDocument()

    const logsForCorrupt = () =>
      errorSpy.mock.calls.filter((args) => String(args[0]).includes('m-corrupt')).length
    await waitFor(() => expect(logsForCorrupt()).toBe(1))

    // A live re-emission (another count) re-partitions the rows; the log
    // still doesn't repeat.
    setCount('7')
    expect(await screen.findByText('Stock: 7')).toBeInTheDocument()
    await waitFor(() => expect(within(list).getAllByRole('listitem')).toHaveLength(2))
    expect(logsForCorrupt()).toBe(1)
  })

  it('a failing history read is contained to the history panel', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await renderLive({ ...brownie, stock: 2 })
    vi.spyOn(database.stockMovements, 'where').mockImplementation(() => {
      throw new Error('boom')
    })

    fireEvent.click(screen.getByRole('button', { name: 'History for Brownie' }))

    expect(await screen.findByText(/something went wrong/i)).toBeInTheDocument()
    expect(screen.getByText('Stock: 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set count for Brownie' })).toBeEnabled()
  })
})
