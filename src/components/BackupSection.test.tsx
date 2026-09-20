import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PosDatabase } from '../db/db'
import { saveSettings } from '../db/settings'
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

  it('offers download links when the phone cannot share files', async () => {
    fireEvent.click(await renderBackup())

    const link = await screen.findByRole('link', { name: /^bakery-pos-.*\.json$/ })
    expect(link).toHaveAttribute('download', expect.stringMatching(/\.json$/))
    expect(link.getAttribute('href')).toContain('data:application/json')
    expect(screen.getByRole('link', { name: /^orders-.*\.csv$/ })).toBeInTheDocument()
  })
})

describe('BackupSection — import', () => {
  /** A file holding one product and one order this device has never seen. */
  function otherShopBackup(): string {
    return JSON.stringify({
      format: 'bakery-pos-backup',
      version: 1,
      exportedAt: new Date().toISOString(),
      dayKey: '2026-09-20',
      products: [{ ...croissant, id: 'p-tart', name: 'Egg tart', price: 4500 }],
      orders: [{ ...cashOrder, id: 'o-new', number: 7 }],
      settings: { shopName: 'Other Bakery', promptPayId: '0899999999', categoryOrder: [] },
    })
  }

  it('shows what the file would do before writing anything, then merges on confirm', async () => {
    await renderBackup()

    choose(backupFile(otherShopBackup()))

    expect(
      await screen.findByText(/1 product, 1 order — 1 new, 0 already here/),
    ).toBeInTheDocument()
    // Nothing written yet: the summary comes first.
    await expect(database.orders.count()).resolves.toBe(1)

    fireEvent.click(screen.getByRole('button', { name: 'Import 1 new' }))

    expect(await screen.findByText(/Imported 1 order and 1 product/)).toBeInTheDocument()
    await expect(database.orders.count()).resolves.toBe(2)
    await expect(database.orders.get('o-new')).resolves.toMatchObject({ number: 7 })
    await expect(database.products.get('p-tart')).resolves.toMatchObject({ name: 'Egg tart' })
    // The shop fields moved; the PIN did not.
    await expect(database.settings.get(SETTINGS_ID)).resolves.toMatchObject({
      shopName: 'Other Bakery',
      ...pin,
    })
  })

  it('leaves the database alone when the import is cancelled', async () => {
    await renderBackup()

    choose(backupFile(otherShopBackup()))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel import' }))

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /^Import/ })).not.toBeInTheDocument(),
    )
    await expect(database.orders.count()).resolves.toBe(1)
  })

  it('explains a corrupt file and offers no way to import it', async () => {
    await renderBackup()

    const corrupt = JSON.parse(otherShopBackup()) as { orders: { total: number }[] }
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
