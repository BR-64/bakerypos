import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { completeOrder } from '../db/orders'
import { getSettings, saveSettings } from '../db/settings'
import { generateSalt, hashPin, MAX_PIN_ATTEMPTS } from '../domain/pin'
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings'
import type { Product, StockMovement } from '../domain/types'
import type { PinLock } from '../hooks/usePinLock'
import { useSettings } from '../hooks/useSettings'
import { AdminScreen } from './AdminScreen'

let database: PosDatabase

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

function stubLock(overrides: Partial<PinLock> = {}): PinLock {
  return {
    unlocked: true,
    lockoutMsLeft: 0,
    attemptsLeft: MAX_PIN_ATTEMPTS,
    unlock: vi.fn(),
    lock: vi.fn(),
    registerFailure: vi.fn(),
    ...overrides,
  }
}

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'cookies',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

const latte: Product = {
  id: 'p-latte',
  name: 'Iced Latte',
  price: 7500,
  category: 'jar',
  sortOrder: 2,
  outOfStock: true,
  archived: false,
}

function renderAdmin(
  options: { lock?: PinLock; settings?: Settings | null; failed?: boolean } = {},
) {
  return render(
    <AdminScreen
      database={database}
      settings={options.settings === undefined ? DEFAULT_SETTINGS : options.settings}
      settingsFailed={options.failed ?? false}
      pinLock={options.lock ?? stubLock()}
    />,
  )
}

describe('AdminScreen — the lock', () => {
  it('shows only the keypad until the PIN is entered', async () => {
    const pinSalt = generateSalt()
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      pinHash: await hashPin('4821', pinSalt),
      pinSalt,
      recoveryHash: null,
    }
    await saveSettings(settings, database)
    await database.products.add(croissant)
    const lock = stubLock({ unlocked: false })
    renderAdmin({ lock, settings })

    expect(screen.getByRole('heading', { name: 'Enter the PIN for Admin' })).toBeInTheDocument()
    // Not a price, not a product name, not a Save button: nothing editable
    // is even rendered behind the prompt.
    expect(screen.queryByText('Croissant')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add product' })).not.toBeInTheDocument()
    // Nor Backup, which would hand whoever picked the phone up every sale
    // the shop has ever made.
    expect(screen.queryByRole('button', { name: 'Export' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Choose a backup file')).not.toBeInTheDocument()

    for (const digit of '4821') fireEvent.click(screen.getByRole('button', { name: digit }))
    fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))

    await waitFor(() => expect(lock.unlock).toHaveBeenCalledTimes(1))
  })

  it('locks again when "Lock" is tapped', () => {
    const lock = stubLock()
    renderAdmin({ lock })

    fireEvent.click(screen.getByRole('button', { name: 'Lock' }))

    expect(lock.lock).toHaveBeenCalledTimes(1)
  })
})

describe('AdminScreen — products', () => {
  it('lists products with their price, category and state', async () => {
    await database.products.bulkAdd([
      croissant,
      latte,
      { ...croissant, id: 'p-old', name: 'Old', price: 1000, archived: true },
    ])
    renderAdmin()

    expect(await screen.findByText('Croissant')).toBeInTheDocument()
    expect(screen.getByText('฿55')).toBeInTheDocument()
    expect(screen.getByText('Iced Latte')).toBeInTheDocument()
    expect(screen.getByText('Sold out')).toBeInTheDocument()
    // Archived products are still listed — they are never deleted.
    expect(screen.getByText('Old')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('offers a photo control per product, and says where photos live', async () => {
    await database.products.bulkAdd([croissant, latte])
    renderAdmin()

    expect(await screen.findByLabelText('Add photo for Croissant')).toBeInTheDocument()
    expect(screen.getByLabelText('Add photo for Iced Latte')).toBeInTheDocument()
    // The owner has to know a backup will not carry these.
    expect(screen.getByText(/not\s+included in a backup/)).toBeInTheDocument()
  })

  it('offers to replace, not add, a photo the product already has', async () => {
    await database.products.bulkAdd([
      {
        ...croissant,
        image: {
          blob: new Blob([new Uint8Array(2048)], { type: 'image/webp' }),
          type: 'image/webp',
          width: 512,
          height: 384,
        },
      },
    ])
    renderAdmin()

    expect(await screen.findByLabelText('Replace photo for Croissant')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove photo from Croissant' })).toBeInTheDocument()
  })

  it('adds a product with a price typed in baht, stored as integer satang', async () => {
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }))
    fireEvent.change(screen.getByLabelText('New product name'), {
      target: { value: 'Almond Croissant' },
    })
    fireEvent.change(screen.getByLabelText('New product price'), { target: { value: '45.50' } })
    fireEvent.change(screen.getByLabelText('New product category'), {
      target: { value: 'cookies' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))

    await waitFor(async () => expect(await database.products.count()).toBe(1))
    const [stored] = await database.products.toArray()
    expect(stored.price).toBe(4550)
    expect(Number.isSafeInteger(stored.price)).toBe(true)
    expect(stored).toMatchObject({ name: 'Almond Croissant', category: 'cookies', archived: false })
  })

  it('refuses a price that is not a plain baht amount, and writes nothing', async () => {
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }))
    fireEvent.change(screen.getByLabelText('New product name'), { target: { value: 'Mystery' } })
    fireEvent.change(screen.getByLabelText('New product price'), { target: { value: '45.555' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a price in baht')
    expect(await database.products.count()).toBe(0)
    // The form stays usable rather than closing on a rejection.
    expect(screen.getByLabelText('New product name')).toHaveValue('Mystery')
  })

  it('edits a name, price and category without touching sort order or stock', async () => {
    await database.products.bulkAdd([croissant, latte])
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Iced Latte' }))
    expect(screen.getByLabelText('Price for Iced Latte')).toHaveValue('75')
    fireEvent.change(screen.getByLabelText('Name for Iced Latte'), {
      target: { value: 'Iced Latte (large)' },
    })
    fireEvent.change(screen.getByLabelText('Price for Iced Latte'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))

    await waitFor(async () =>
      expect(await database.products.get('p-latte')).toEqual({
        ...latte,
        name: 'Iced Latte (large)',
        price: 8500,
      }),
    )
  })

  it('never rewrites history: editing a price leaves an existing order alone', async () => {
    await database.products.add(croissant)
    const order = await completeOrder(
      [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 1 }],
      { method: 'cash', tendered: 5500, change: 0 },
      database,
    )
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Edit Croissant' }))
    fireEvent.change(screen.getByLabelText('Price for Croissant'), { target: { value: '99' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save product' }))

    await waitFor(async () =>
      expect((await database.products.get('p-croissant'))?.price).toBe(9900),
    )
    expect(await database.orders.get(order.id)).toEqual(order)
  })

  it('toggles out of stock', async () => {
    await database.products.add(croissant)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Croissant sold out' }))

    await waitFor(async () =>
      expect((await database.products.get('p-croissant'))?.outOfStock).toBe(true),
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Mark Croissant in stock' }))
    await waitFor(async () =>
      expect((await database.products.get('p-croissant'))?.outOfStock).toBe(false),
    )
  })

  it('archives rather than deleting, after a confirmation', async () => {
    await database.products.add(croissant)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Archive Croissant' }))
    expect(screen.getByText('Archive Croissant?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(await database.products.count()).toBe(1)
    expect((await database.products.get('p-croissant'))?.archived).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Archive Croissant' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, archive' }))

    await waitFor(async () =>
      expect((await database.products.get('p-croissant'))?.archived).toBe(true),
    )
    // The row is still there — archiving is never a delete.
    expect(await database.products.count()).toBe(1)
  })

  it('shows an error and keeps the list usable when a write is rejected', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.products.add(croissant)
    vi.spyOn(database.products, 'update').mockRejectedValue(new Error('disk full'))
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'Mark Croissant sold out' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('disk full')
    expect(screen.getByRole('button', { name: 'Mark Croissant sold out' })).toBeEnabled()
  })

  it('skips and counts a corrupt product instead of crashing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.products.bulkAdd([
      croissant,
      {
        id: 'p-bad',
        name: '',
        price: 'lots',
        category: 'cookies',
        sortOrder: 9,
      } as unknown as Product,
    ])
    renderAdmin()

    expect(await screen.findByText('Croissant')).toBeInTheDocument()
    expect(screen.getByText('1 product couldn’t be displayed.')).toBeInTheDocument()
  })
})

describe('AdminScreen — stock', () => {
  it('renders no stock control at all while locked', async () => {
    const pinSalt = generateSalt()
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      pinHash: await hashPin('4821', pinSalt),
      pinSalt,
      recoveryHash: null,
    }
    await database.products.add({ ...croissant, stock: 5 })
    renderAdmin({ lock: stubLock({ unlocked: false }), settings })

    expect(screen.getByRole('heading', { name: 'Enter the PIN for Admin' })).toBeInTheDocument()
    // Give the (never-mounted) product list every chance to appear.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(screen.queryByText('Stock: 5')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set count/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Received/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /History/ })).not.toBeInTheDocument()
  })

  it('sets a count, then offers "+ Received", and shows both in the history', async () => {
    await database.products.bulkAdd([croissant, latte])
    renderAdmin()

    expect(await screen.findAllByText('Not tracked')).toHaveLength(2)
    expect(
      screen.queryByRole('button', { name: '+ Received for Croissant' }),
    ).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Set count for Croissant' }))
    fireEvent.change(screen.getByLabelText('New count for Croissant'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Stock: 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Received for Croissant' }))
    fireEvent.change(screen.getByLabelText('How many Croissant arrived'), {
      target: { value: '3' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Stock: 8')).toBeInTheDocument()

    // The other product is untouched, and stock never flips the sold-out toggle.
    expect(screen.getByText('Not tracked')).toBeInTheDocument()
    expect((await database.products.get('p-croissant'))?.outOfStock).toBe(false)
    expect((await database.products.get('p-latte'))?.stock).toBeUndefined()

    fireEvent.click(screen.getByRole('button', { name: 'History for Croissant' }))
    const list = await screen.findByRole('list', { name: 'Stock history' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    // Same millisecond is possible in a test, so check each row's content
    // rather than relying on their order here (StockControls.test pins it).
    const texts = rows.map((row) => row.textContent ?? '')
    expect(
      texts.some((t) => t.includes('Received') && t.includes('+3') && t.includes('now 8')),
    ).toBe(true)
    expect(texts.some((t) => t.includes('Count') && t.includes('+5') && t.includes('now 5'))).toBe(
      true,
    )
  })

  it('skips a corrupt history row and counts it', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    await database.products.add({ ...croissant, stock: 2 })
    await database.stockMovements.add({
      id: 'm-bad',
      productId: 'p-croissant',
      kind: 'teleport',
      delta: 2,
      level: 2,
      previous: null,
      createdAt: new Date().toISOString(),
    } as unknown as StockMovement)
    renderAdmin()

    fireEvent.click(await screen.findByRole('button', { name: 'History for Croissant' }))

    expect(await screen.findByText('1 entry couldn’t be displayed.')).toBeInTheDocument()
    expect(screen.getByText('No stock changes yet.')).toBeInTheDocument()
  })

  it('says stock stays on this phone, like photos', async () => {
    renderAdmin()
    expect(
      await screen.findByText(/Stock counts and their history also stay on this phone/),
    ).toBeInTheDocument()
  })
})

describe('AdminScreen — shop settings', () => {
  it('saves the shop name and PromptPay ID without disturbing the stored PIN', async () => {
    const pinSalt = generateSalt()
    const pinHash = await hashPin('4821', pinSalt)
    const settings: Settings = { ...DEFAULT_SETTINGS, pinHash, pinSalt, recoveryHash: null }
    await saveSettings(settings, database)
    renderAdmin({ settings })

    fireEvent.change(screen.getByLabelText('Shop name'), { target: { value: 'Sunrise Bakery' } })
    fireEvent.change(screen.getByLabelText('PromptPay ID'), { target: { value: '0812345678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save shop settings' }))

    await waitFor(async () =>
      expect(await getSettings(database)).toEqual({
        ...settings,
        shopName: 'Sunrise Bakery',
        promptPayId: '0812345678',
      }),
    )
  })

  it('confirms a save on screen, with settings coming from a live query as App feeds them', async () => {
    // `renderAdmin` passes a static `settings` prop; App passes the live
    // query's value, which re-emits on every save. Anything that remounted
    // the form on that re-emission would throw away the confirmation the
    // owner is waiting for, and no static-prop test would notice.
    function LiveAdmin() {
      const { settings, failed } = useSettings(database)
      return (
        <AdminScreen
          database={database}
          settings={settings}
          settingsFailed={failed}
          pinLock={stubLock()}
        />
      )
    }
    render(<LiveAdmin />)

    fireEvent.change(await screen.findByLabelText('Shop name'), {
      target: { value: 'Sunrise Bakery' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save shop settings' }))

    expect(await screen.findByText('Saved')).toBeInTheDocument()
    expect(screen.getByLabelText('Shop name')).toHaveValue('Sunrise Bakery')
    await waitFor(async () => expect((await getSettings(database)).shopName).toBe('Sunrise Bakery'))
  })

  it('rejects a malformed PromptPay ID before it can reach a QR', async () => {
    renderAdmin()

    fireEvent.change(screen.getByLabelText('PromptPay ID'), { target: { value: '081-234-5678' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save shop settings' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('10-digit phone number')
    expect(await database.settings.count()).toBe(0)
  })

  it('reorders the category tabs and saves it', async () => {
    renderAdmin()

    fireEvent.click(screen.getByRole('button', { name: 'Move Jar up' }))

    await waitFor(async () =>
      expect((await getSettings(database)).categoryOrder).toEqual([
        'brownies',
        'jar',
        'cookies',
        'other',
      ]),
    )
  })

  it('will not overwrite settings it could not read, but still edits the menu', async () => {
    await database.products.add(croissant)
    renderAdmin({ failed: true })

    expect(screen.getByRole('alert')).toHaveTextContent(/can’t be changed here/)
    expect(screen.queryByLabelText('Shop name')).not.toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Edit Croissant' })).toBeInTheDocument()
  })

  it('waits for the settings read rather than showing defaults as if they were stored', () => {
    renderAdmin({ settings: null })

    expect(screen.getByText('Loading shop settings…')).toBeInTheDocument()
    expect(screen.queryByLabelText('Shop name')).not.toBeInTheDocument()
  })
})
