import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { saveSettings } from '../db/settings'
import { MAX_IMPORT_BYTES, TOO_LARGE_MESSAGE } from '../domain/backup'
import { DEFAULT_SETTINGS, SETTINGS_ID, type Settings } from '../domain/settings'
import type { Order, Product } from '../domain/types'
import { BackupSection } from './BackupSection'

let database: PosDatabase

const croissant: Product = {
  id: 'p-croissant',
  name: 'Croissant',
  price: 5500,
  category: 'pastry',
  sortOrder: 1,
  outOfStock: false,
  archived: false,
}

function at(hour: number, minute = 0): string {
  const when = new Date()
  when.setHours(hour, minute, 0, 0)
  return when.toISOString()
}

const cashOrder: Order = {
  id: 'o-1',
  number: 1,
  lines: [{ productId: 'p-croissant', name: 'Croissant', unitPrice: 5500, qty: 2 }],
  total: 11000,
  payment: { method: 'cash', tendered: 20000, change: 9000 },
  status: 'completed',
  createdAt: at(9, 5),
  sync: 'pending',
}

const pin = { pinHash: 'a'.repeat(64), pinSalt: 'c'.repeat(32), recoveryHash: 'b'.repeat(64) }

const shopSettings: Settings = {
  ...DEFAULT_SETTINGS,
  ...pin,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
}

beforeEach(async () => {
  database = new PosDatabase(`test-${Math.random()}`)
  await database.open()
  await database.products.add(croissant)
  await database.orders.add(cashOrder)
  await saveSettings(shopSettings, database)
})

afterEach(() => {
  Reflect.deleteProperty(navigator, 'share')
  Reflect.deleteProperty(navigator, 'canShare')
  vi.restoreAllMocks()
})

function installNavigatorApi(name: 'share' | 'canShare', value: unknown): void {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true })
}

/** Render, then wait for the export data to load (the button stops being disabled). */
async function renderBackup() {
  render(<BackupSection database={database} />)
  const exportButton = await screen.findByRole('button', { name: 'Export' })
  await waitFor(() => expect(exportButton).toBeEnabled())
  return exportButton
}

/** Drop `file` on the file input the way a phone's file picker would. */
function choose(file: File): void {
  const input = screen.getByLabelText('Choose a backup file')
  Object.defineProperty(input, 'files', { value: [file], configurable: true })
  fireEvent.change(input)
}

function backupFile(text: string, name = 'bakery-pos-2026-09-20.json'): File {
  return new File([text], name, { type: 'application/json' })
}

describe('BackupSection — export', () => {
  it('shares both files, with satang in the JSON and baht in the CSV', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    installNavigatorApi('share', share)
    installNavigatorApi('canShare', vi.fn().mockReturnValue(true))

    fireEvent.click(await renderBackup())

    expect(share).toHaveBeenCalledTimes(1)
    const files = (share.mock.calls[0][0] as { files: File[] }).files
    expect(files.map((file) => file.name)).toEqual([
      expect.stringMatching(/^bakery-pos-\d{4}-\d{2}-\d{2}\.json$/),
      expect.stringMatching(/^orders-\d{4}-\d{2}-\d{2}\.csv$/),
    ])

    const json = await files[0].text()
    expect(JSON.parse(json).orders[0].total).toBe(11000)
    expect(json).not.toContain('pinHash')
    expect(json).not.toContain('a'.repeat(64))

    // `Blob.text()` strips the BOM on decode, so the bytes are what prove
    // it is there — it is what stops Excel mangling a Thai product name.
    const csvBytes = new Uint8Array(await files[1].arrayBuffer())
    expect([...csvBytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const csv = await files[1].text()
    expect(csv).toContain('1,09:05,Croissant,2,55.00,110.00,cash,completed')
  })

  it('raises an alert naming what could not be included, product and order apart', async () => {
    // Written straight to the tables, the way a half-corrupted record
    // would actually arrive.
    await database.products.add({ ...croissant, id: 'p-bad', price: 12.5 } as Product)
    await database.orders.add({ ...cashOrder, id: 'o-bad', total: 999 })

    fireEvent.click(await renderBackup())

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/1 product and 1 order/)
    expect(alert).toHaveTextContent(/still on this phone/)
  })

  it('offers download links when the phone cannot share files', async () => {
    fireEvent.click(await renderBackup())

    const link = await screen.findByRole('link', { name: /^bakery-pos-.*\.json$/ })
    expect(link).toHaveAttribute('download', expect.stringMatching(/\.json$/))
    expect(link.getAttribute('href')).toContain('data:application/json')
    expect(screen.getByRole('link', { name: /^orders-.*\.csv$/ })).toBeInTheDocument()
  })
})

describe('BackupSection — import', () => {
  /**
   * An older backup of this same shop: one product this phone has never
   * seen, one order it hasn't either, the croissant at the price it used
   * to be, and the PromptPay account the shop has since left.
   */
  function olderBackup(): string {
    return JSON.stringify({
      format: 'bakery-pos-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      dayKey: '2026-09-20',
      products: [
        { ...croissant, id: 'p-tart', name: 'Egg tart', price: 4500 },
        { ...croissant, price: 4500 },
      ],
      orders: [{ ...cashOrder, id: 'o-new', number: 7 }],
      settings: { shopName: 'Other Bakery', promptPayId: '0899999999', categoryOrder: [] },
    })
  }

  it('spells out every change outside the orders table before writing anything', async () => {
    await renderBackup()

    choose(backupFile(olderBackup()))

    expect(
      await screen.findByText(/2 products, 1 order — 1 new, 0 already here/),
    ).toBeInTheDocument()
    // Every detail change, with the value it would replace.
    expect(screen.getByText('Shop name: Sunrise Bakery → Other Bakery')).toBeInTheDocument()
    expect(screen.getByText('PromptPay ID: 0812345678 → 0899999999')).toBeInTheDocument()
    expect(screen.getByText(/1 product already here would be replaced/)).toBeInTheDocument()
    expect(screen.getByText('Croissant: ฿55 → ฿45')).toBeInTheDocument()
    // Nothing written yet: the summary comes first.
    await expect(database.orders.count()).resolves.toBe(1)
  })

  it('merges the orders without touching the settings or the price when the box is left unticked', async () => {
    await renderBackup()

    choose(backupFile(olderBackup()))
    const box = await screen.findByRole('checkbox', {
      name: 'Also replace shop settings and product details',
    })
    // This phone already has settings and one of the file's products, so
    // replacing details is opt-in.
    expect(box).not.toBeChecked()

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 order and 1 product' }))

    expect(await screen.findByText(/Imported 1 order and 1 product/)).toBeInTheDocument()
    // The orders merged…
    await expect(database.orders.count()).resolves.toBe(2)
    await expect(database.orders.get('o-new')).resolves.toMatchObject({ number: 7 })
    await expect(database.products.get('p-tart')).resolves.toMatchObject({ name: 'Egg tart' })
    // …while the till still charges ฿55 and still pays the current account.
    await expect(database.products.get('p-croissant')).resolves.toMatchObject({ price: 5500 })
    await expect(database.settings.get(SETTINGS_ID)).resolves.toMatchObject({
      shopName: 'Sunrise Bakery',
      promptPayId: '0812345678',
      ...pin,
    })
    expect(screen.getByText(/Shop settings left as they were/)).toBeInTheDocument()
  })

  it('applies the settings and the price when the box is ticked', async () => {
    await renderBackup()

    choose(backupFile(olderBackup()))
    fireEvent.click(
      await screen.findByRole('checkbox', {
        name: 'Also replace shop settings and product details',
      }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Import 1 order, 1 product and the shop details' }),
    )

    expect(await screen.findByText(/Shop settings updated/)).toBeInTheDocument()
    await expect(database.products.get('p-croissant')).resolves.toMatchObject({ price: 4500 })
    await expect(database.orders.count()).resolves.toBe(2)
    // The PIN is untouched either way.
    await expect(database.settings.get(SETTINGS_ID)).resolves.toMatchObject({
      shopName: 'Other Bakery',
      promptPayId: '0899999999',
      ...pin,
    })
  })

  it('warns that an imported order would repeat a number already on this phone', async () => {
    await renderBackup()
    const file = JSON.parse(olderBackup()) as { orders: { number: number }[] }
    file.orders[0].number = cashOrder.number

    choose(backupFile(JSON.stringify(file)))

    expect(
      await screen.findByText(
        /1 imported order shares a number with an order already on this phone/,
      ),
    ).toBeInTheDocument()
  })

  it('clears the export confirmation, so it cannot be read as the import’s result', async () => {
    installNavigatorApi('share', vi.fn().mockResolvedValue(undefined))
    installNavigatorApi('canShare', vi.fn().mockReturnValue(true))
    fireEvent.click(await renderBackup())
    expect(await screen.findByText('Shared.')).toBeInTheDocument()

    choose(backupFile(olderBackup()))

    expect(await screen.findByRole('button', { name: /^Import/ })).toBeInTheDocument()
    expect(screen.queryByText('Shared.')).not.toBeInTheDocument()
  })

  it('refuses a file too big to read before it is read at all', async () => {
    await renderBackup()
    const huge = backupFile('{}')
    Object.defineProperty(huge, 'size', { value: MAX_IMPORT_BYTES + 1 })
    const text = vi.spyOn(huge, 'text')

    choose(huge)

    expect(await screen.findByRole('alert')).toHaveTextContent(TOO_LARGE_MESSAGE)
    // Never read into memory: a gigabyte here is an out-of-memory kill.
    expect(text).not.toHaveBeenCalled()
  })

  it('leaves the database alone when the import is cancelled', async () => {
    await renderBackup()

    choose(backupFile(olderBackup()))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument(),
    )
    await expect(database.orders.count()).resolves.toBe(1)
  })

  it('explains a corrupt file and offers no way to import it', async () => {
    await renderBackup()

    const corrupt = JSON.parse(olderBackup()) as { orders: { total: number }[] }
    corrupt.orders[0].total = 1
    choose(backupFile(JSON.stringify(corrupt)))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Order 1 in that file has a total that does not match its lines/,
    )
    expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument()
    await expect(database.orders.count()).resolves.toBe(1)
  })

  it('explains a file that is not a backup at all', async () => {
    await renderBackup()

    choose(backupFile('not json at all', 'holiday-photo.json'))

    expect(await screen.findByRole('alert')).toHaveTextContent(/isn't readable JSON/)
    await expect(database.orders.count()).resolves.toBe(1)
  })
})
