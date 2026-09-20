import { partitionCartLines } from './cart'
import { isKnownCategory } from './categories'
import { formatLocalTime, localDayKey, localDayRange } from './day'
import { cartTotal, formatBahtDecimal, lineTotal } from './money'
import { isValidOrder } from './order'
import { coerceSettings } from './settings'
import type { Category, Order, OrderLine, Payment, Product } from './types'

/**
 * Backup, export and import — pure. No React, no Dexie: everything here
 * takes plain arrays and strings, so every rule below is unit-tested
 * directly and `src/db/backup.ts` is left with nothing but the
 * transaction.
 *
 * Two hard rules shape the whole file:
 *
 * 1. **The PIN never travels.** The exported settings are built by an
 *    *allowlist* of three fields, not by deleting the sensitive ones, so a
 *    field added to `Settings` later cannot leak into a file by being
 *    forgotten here. In the other direction `parseImport` returns the same
 *    three fields and nothing else, so no file — however it was edited —
 *    can carry a `pinHash` back onto a device and unlock Admin.
 * 2. **An imported file is untrusted, doubly so.** It reaches the orders
 *    table, which is the money record, so `parseImport` never throws on
 *    any input and rejects the file *whole* rather than importing the
 *    readable half of it. Records are rebuilt field by field from an
 *    allowlist, so nothing the file carries beyond our own schema is ever
 *    handed to Dexie.
 */

/** Marker that says a JSON file is one of ours, checked before anything else. */
export const BACKUP_FORMAT = 'bakery-pos-backup'

/**
 * Format version of the payload below. Bump it when the *shape* changes;
 * `parseImport` refuses anything it doesn't know rather than guessing at
 * a future file written by a newer build.
 */
export const BACKUP_FORMAT_VERSION = 1

/**
 * Longest import file we'll even try to `JSON.parse`, in characters
 * (~20 MB of JSON, tens of thousands of orders). Past that the parse is
 * more likely to hang the phone than to succeed, and the person is better
 * told so than left with a frozen screen.
 */
export const MAX_IMPORT_CHARS = 20_000_000

/**
 * Byte-order mark for the CSV file. Not part of `buildOrdersCsv`'s output
 * (tests and the JSON path want the plain text), but prefixed by whoever
 * builds the actual file: without it Excel reads a UTF-8 CSV as the local
 * codepage and Thai product names arrive as mojibake.
 */
export const UTF8_BOM = '﻿'

/**
 * The shop settings as they appear in a backup: the three fields that
 * describe the shop, and nothing else. Explicitly **not** `pinHash`,
 * `pinSalt`, `recoveryHash` or `lockedUntil`.
 */
export interface ExportedSettings {
  shopName: string
  promptPayId: string
  categoryOrder: Category[]
}

/** The JSON file's top-level object. */
export interface BackupPayload {
  format: typeof BACKUP_FORMAT
  version: number
  /** When the export was taken, as a canonical UTC ISO instant. */
  exportedAt: string
  /** The **local** day of the export, `YYYY-MM-DD` — matches the file name. */
  dayKey: string
  products: Product[]
  orders: Order[]
  settings: ExportedSettings
}

/** What `buildExport` is handed: whatever the three tables actually held. */
export interface BackupInput {
  products: unknown[]
  orders: unknown[]
  settings: unknown
}

/** Why a file was refused. The screen shows `error`; `reason` is for tests and logs. */
export type ImportRejection =
  | 'empty'
  | 'too-large'
  | 'not-json'
  | 'not-a-backup'
  | 'unsupported-version'
  | 'bad-products'
  | 'bad-orders'

export type ImportResult =
  { ok: true; payload: BackupPayload } | { ok: false; reason: ImportRejection; error: string }

function reject(reason: ImportRejection, error: string): ImportResult {
  return { ok: false, reason, error }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Whether `value` is an ISO instant in the exact shape `Date#toISOString`
 * produces — UTC, trailing `Z`, zero-padded.
 *
 * Stricter than `isValidOrder`'s "parses to an instant" on purpose.
 * `ordersForDay` (`src/db/orders.ts`) selects the day by *string*
 * comparison on the `createdAt` index, so an order with a valid but
 * non-canonical timestamp (say `2026-01-14T07:00:01.000-10:00`) sorts
 * unpredictably against the range: it would be stored happily and then be
 * invisible to the Orders screen and to every Z report, with no error
 * anywhere. Importing money that can never be seen again is worse than
 * refusing the file, so this is a hard requirement on anything we write.
 */
function isCanonicalInstant(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false
  const at = new Date(value).getTime()
  return Number.isFinite(at) && new Date(at).toISOString() === value
}

function isDayKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function usableDate(value: Date): Date {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value : new Date()
}

/**
 * What's wrong with `value` as a product, or `null` if nothing is.
 *
 * Deliberately the same predicate `buildExport` filters with and
 * `parseImport` enforces: an export is therefore always re-importable, and
 * the round trip is exact for every record that passes.
 */
function productProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'is not an object'
  const { id, name, price, category, sortOrder, archived, outOfStock } = value
  if (typeof id !== 'string' || id.length === 0) return 'has no id'
  if (typeof name !== 'string' || name.trim().length === 0) return 'has no name'
  if (!Number.isSafeInteger(price) || (price as number) < 0) {
    return 'has a price that is not whole satang'
  }
  if (!isKnownCategory(category)) return 'has an unknown category'
  if (typeof sortOrder !== 'number' || !Number.isFinite(sortOrder)) {
    return 'has an unusable sort position'
  }
  if (archived !== undefined && typeof archived !== 'boolean') return 'has a corrupt archived flag'
  if (outOfStock !== undefined && typeof outOfStock !== 'boolean') {
    return 'has a corrupt sold-out flag'
  }
  return null
}

/** A product rebuilt from an allowlist of its seven fields — never the caller's object. */
function readProduct(value: Record<string, unknown>): Product {
  return {
    id: value.id as string,
    name: value.name as string,
    price: value.price as number,
    category: value.category as Category,
    sortOrder: value.sortOrder as number,
    // Absent is the same as false everywhere else in the app (every read
    // is a `=== true` check), so it is normalised here rather than
    // rejected: a missing flag is not a reason to leave a product out of
    // the shop's backup.
    outOfStock: value.outOfStock === true,
    archived: value.archived === true,
  }
}

function readPayment(payment: Record<string, unknown>): Payment {
  if (payment.method === 'cash') {
    return {
      method: 'cash',
      tendered: payment.tendered as number,
      change: payment.change as number,
    }
  }
  return { method: 'promptpay', confirmedAt: payment.confirmedAt as string }
}

function readLine(line: OrderLine): OrderLine {
  return { productId: line.productId, name: line.name, unitPrice: line.unitPrice, qty: line.qty }
}

/**
 * What's wrong with `value` as an order, or `null` if nothing is. Stricter
 * than `isValidOrder` (which only has to be safe to *render*) because this
 * decides what gets **written** to the money record:
 *
 * - every header field `isValidOrder` checks, plus
 * - `createdAt` (and `voidedAt`, when present) canonical UTC — see
 *   `isCanonicalInstant`
 * - `sync` exactly `'pending'` or `'synced'`
 * - at least one line, every line readable and non-duplicate
 *   (`partitionCartLines`, the same rule the cart and the Z report use)
 * - the stored `total` equal to the sum of those lines. A file whose
 *   arithmetic doesn't add up is a file we cannot vouch for, and the
 *   stored total is what every report counts.
 */
function orderProblem(value: unknown): string | null {
  if (!isValidOrder(value)) return 'is not shaped like an order'
  const raw = value as unknown as Record<string, unknown>
  if (!isCanonicalInstant(raw.createdAt)) return 'has a timestamp that is not a UTC ISO instant'
  if (raw.voidedAt !== undefined && !isCanonicalInstant(raw.voidedAt)) {
    return 'has a void timestamp that is not a UTC ISO instant'
  }
  if (raw.sync !== 'pending' && raw.sync !== 'synced') return 'has an unknown sync state'
  if (!Array.isArray(raw.lines) || raw.lines.length === 0) return 'has no lines'
  const { valid, invalid } = partitionCartLines(raw.lines as OrderLine[])
  if (invalid.length > 0) return 'has a line that cannot be read'
  if (cartTotal(valid) !== value.total) return 'has a total that does not match its lines'
  return null
}

/** An order rebuilt field by field. Optional fields are omitted, not set to `undefined`. */
function readOrder(order: Order): Order {
  const rebuilt: Order = {
    id: order.id,
    number: order.number,
    lines: order.lines.map(readLine),
    total: order.total,
    payment: readPayment(order.payment as unknown as Record<string, unknown>),
    status: order.status,
    createdAt: order.createdAt,
    sync: order.sync,
  }
  if (order.voidedAt !== undefined) rebuilt.voidedAt = order.voidedAt
  if (order.voidReason !== undefined) rebuilt.voidReason = order.voidReason
  return rebuilt
}

/**
 * The shop settings as a backup carries them. Built by picking three
 * fields off a `coerceSettings` result: coercion repairs a corrupt row
 * field by field (so one bad shop name can't cost the owner their
 * PromptPay ID), and the pick is what guarantees nothing else — PIN hash,
 * salt, recovery hash, lockout deadline — can follow them into the file.
 */
function readExportedSettings(value: unknown): ExportedSettings {
  const settings = coerceSettings(value)
  return {
    shopName: settings.shopName,
    promptPayId: settings.promptPayId,
    categoryOrder: [...settings.categoryOrder],
  }
}

/**
 * Build the JSON payload for a backup.
 *
 * Records that wouldn't survive `parseImport` are left out rather than
 * written into a file that would then be refused whole — so an export is
 * always importable, and the caller compares `payload.products.length`
 * with what it passed in to tell the owner how many records couldn't be
 * included. Ids are de-duplicated, first occurrence winning, for the same
 * reason.
 *
 * Money is untouched integer satang here; the two-decimal baht is the
 * CSV's business (`buildOrdersCsv`).
 */
export function buildExport(input: BackupInput, now: Date = new Date()): BackupPayload {
  const at = usableDate(now)
  const raw = isPlainObject(input) ? input : { products: [], orders: [], settings: undefined }

  const products: Product[] = []
  const productIds = new Set<string>()
  for (const candidate of Array.isArray(raw.products) ? raw.products : []) {
    if (productProblem(candidate) !== null) continue
    const product = readProduct(candidate as Record<string, unknown>)
    if (productIds.has(product.id)) continue
    productIds.add(product.id)
    products.push(product)
  }

  const orders: Order[] = []
  const orderIds = new Set<string>()
  for (const candidate of Array.isArray(raw.orders) ? raw.orders : []) {
    if (orderProblem(candidate) !== null) continue
    const order = readOrder(candidate as Order)
    if (orderIds.has(order.id)) continue
    orderIds.add(order.id)
    orders.push(order)
  }

  return {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    exportedAt: at.toISOString(),
    dayKey: localDayKey(at),
    products,
    orders,
    settings: readExportedSettings(raw.settings),
  }
}

/** `bakery-pos-2026-09-20.json`, dated by the **local** day (never a UTC slice). */
export function backupFileName(now: Date = new Date()): string {
  return `bakery-pos-${localDayKey(usableDate(now))}.json`
}

/** `orders-2026-09-20.csv`, dated by the same local day. */
export function ordersCsvFileName(now: Date = new Date()): string {
  return `orders-${localDayKey(usableDate(now))}.csv`
}

export const ORDERS_CSV_HEADER = [
  'Order',
  'Time',
  'Product',
  'Qty',
  'Unit price (baht)',
  'Line total (baht)',
  'Payment',
  'Status',
]

const NEEDS_QUOTING = /[",\r\n]/
/**
 * Leading characters a spreadsheet reads as the start of a formula. A
 * product could genuinely be named `+1 Croissant`, and opening the day's
 * sales in Excel must not run it.
 */
const FORMULA_START = /^[=+\-@\t\r]/

function quote(field: string): string {
  return NEEDS_QUOTING.test(field) || field !== field.trim()
    ? `"${field.replace(/"/g, '""')}"`
    : field
}

/** A free-text cell (a product name): formula-guarded, then quoted if it needs it. */
function csvText(value: string): string {
  return quote(FORMULA_START.test(value) ? `'${value}` : value)
}

/**
 * One local day's sales as CSV, **one row per order line**: order number,
 * time, product, qty, unit price, line total, payment method, status.
 *
 * The day is filtered here, by each order's *parsed* instant against
 * `localDayRange` — exactly as `buildZReport` re-filters — so the rows in
 * `orders-YYYY-MM-DD.csv` are the same set of orders the Z report for that
 * day totals, whatever the caller passed in.
 *
 * Money is two-decimal baht (`formatBahtDecimal`, integer arithmetic), the
 * one place in the app where it isn't satang: a spreadsheet column of
 * satang would be read as baht by every human who opened it. The JSON
 * backup keeps satang.
 *
 * Voided orders get rows too, marked `voided` in the status column, and
 * are excluded from the Z report's totals — so summing the *completed*
 * rows' line totals reproduces `ZReport.total` exactly. (The one exception
 * is an order whose lines don't add up to its stored total, which the Z
 * report counts as `mismatchedTotalCount` and reports by stored total; the
 * CSV, being a line-level view, shows the lines.)
 *
 * `orders` is `unknown[]`: the rows come from IndexedDB, so this must
 * never throw whatever it is handed. Unreadable orders and lines are
 * skipped, never guessed at.
 */
export function buildOrdersCsv(orders: unknown[], day: Date = new Date()): string {
  const at = usableDate(day)
  const { startISO, endISO } = localDayRange(at)
  const startMs = new Date(startISO).getTime()
  const endMs = new Date(endISO).getTime()

  const rows: string[] = [ORDERS_CSV_HEADER.map(csvText).join(',')]
  const onDay = (Array.isArray(orders) ? orders : [])
    .filter((order): order is Order => {
      if (!isValidOrder(order)) return false
      const instant = new Date(order.createdAt).getTime()
      return instant >= startMs && instant < endMs
    })
    // Oldest first, the order the day actually happened in. `number`
    // breaks a tie between two orders stored in the same millisecond.
    .sort((a, b) =>
      a.createdAt === b.createdAt ? a.number - b.number : a.createdAt < b.createdAt ? -1 : 1,
    )

  for (const order of onDay) {
    const { valid } = partitionCartLines(Array.isArray(order.lines) ? order.lines : [])
    for (const line of valid) {
      rows.push(
        [
          String(order.number),
          formatLocalTime(order.createdAt),
          csvText(line.name),
          String(line.qty),
          formatBahtDecimal(line.unitPrice),
          formatBahtDecimal(lineTotal(line)),
          order.payment.method,
          order.status,
        ].join(','),
      )
    }
  }

  // CRLF and a trailing newline: RFC 4180, and what Excel expects.
  return `${rows.join('\r\n')}\r\n`
}

/**
 * Validate an already-parsed payload, rebuilding it from an allowlist.
 *
 * Shared by `parseImport` (which parses the text first) and
 * `importBackup` (`src/db/backup.ts`), which re-runs it immediately before
 * the transaction rather than trusting its caller — this is the last gate
 * in front of the orders table.
 *
 * Never throws. The whole file is refused on the first bad record: a
 * half-imported backup would leave the owner unable to tell what they
 * have.
 */
export function validateBackup(value: unknown): ImportResult {
  if (!isPlainObject(value)) return reject('not-a-backup', 'That file is not a Bakery POS backup.')
  if (value.format !== BACKUP_FORMAT) {
    return reject('not-a-backup', 'That file is not a Bakery POS backup.')
  }
  if (value.version !== BACKUP_FORMAT_VERSION) {
    return reject(
      'unsupported-version',
      `That backup is version ${String(value.version)}; this app reads version ${BACKUP_FORMAT_VERSION}.`,
    )
  }

  if (!Array.isArray(value.products)) {
    return reject('bad-products', 'That backup has no product list.')
  }
  const products: Product[] = []
  const productIds = new Set<string>()
  for (const [index, candidate] of value.products.entries()) {
    const problem = productProblem(candidate)
    if (problem !== null) {
      return reject('bad-products', `Product ${index + 1} in that file ${problem}.`)
    }
    const product = readProduct(candidate as Record<string, unknown>)
    if (productIds.has(product.id)) {
      return reject('bad-products', `That file lists product ${product.name} twice.`)
    }
    productIds.add(product.id)
    products.push(product)
  }

  if (!Array.isArray(value.orders)) {
    return reject('bad-orders', 'That backup has no order list.')
  }
  const orders: Order[] = []
  const orderIds = new Set<string>()
  for (const [index, candidate] of value.orders.entries()) {
    const problem = orderProblem(candidate)
    if (problem !== null) {
      return reject('bad-orders', `Order ${index + 1} in that file ${problem}.`)
    }
    const order = readOrder(candidate as Order)
    if (orderIds.has(order.id)) {
      return reject('bad-orders', `That file lists order #${order.number} twice.`)
    }
    orderIds.add(order.id)
    orders.push(order)
  }

  return {
    ok: true,
    payload: {
      format: BACKUP_FORMAT,
      version: BACKUP_FORMAT_VERSION,
      exportedAt: isCanonicalInstant(value.exportedAt) ? value.exportedAt : '',
      dayKey: isDayKey(value.dayKey) ? value.dayKey : '',
      products,
      orders,
      // Never rejected, only repaired: a shop name someone edited to 60
      // characters must not stand between the owner and their orders.
      settings: readExportedSettings(value.settings),
    },
  }
}

/** Keys that must never survive a parse, whatever a file says. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

/**
 * Read an export file: either a validated payload or a structured
 * rejection, **never** a throw — not for junk, truncated JSON, the wrong
 * shape, a corrupt row, numbers past `Number.MAX_SAFE_INTEGER`, or keys
 * like `__proto__`, which the reviver drops before anything ever looks at
 * the object.
 */
export function parseImport(text: unknown): ImportResult {
  if (typeof text !== 'string' || text.trim().length === 0) {
    return reject('empty', 'That file is empty.')
  }
  if (text.length > MAX_IMPORT_CHARS) {
    return reject('too-large', 'That file is too big to read on this phone.')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text, (key, candidate: unknown) =>
      FORBIDDEN_KEYS.has(key) ? undefined : candidate,
    )
  } catch {
    return reject('not-json', "That file isn't readable JSON.")
  }
  return validateBackup(parsed)
}
