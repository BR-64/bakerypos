import { partitionCartLines } from './cart'
import { categoryLabel, isKnownCategory } from './categories'
import { formatLocalTime, localDayKey, localDayRange } from './day'
import { cartTotal, formatBahtDecimal, lineTotal } from './money'
import { isValidOrder } from './order'
import { MAX_PRODUCT_NAME_LENGTH, MAX_PRODUCT_PRICE } from './productDraft'
import { coerceSettings } from './settings'
import type { Category, Order, OrderLine, Payment, Product, Satang } from './types'

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
 * The same limit in bytes, for a `File.size` check *before* the file is
 * read into memory. A 1 GB file picked by mistake is an out-of-memory kill
 * that no `try/catch` can catch, so the size is what the screen looks at
 * first; UTF-8 is never fewer bytes than characters, so a file inside this
 * is always inside `MAX_IMPORT_CHARS` too.
 */
export const MAX_IMPORT_BYTES = MAX_IMPORT_CHARS

/** One wording for "too big", shared by the size check and the parse. */
export const TOO_LARGE_MESSAGE = 'That file is too big to read on this phone.'

/**
 * Largest order `number` an import will accept.
 *
 * Not a cosmetic bound. `completeOrder` numbers the next sale
 * `(highest stored number) + 1`; a file carrying
 * `Number.MAX_SAFE_INTEGER` would make every later sale's number unsafe,
 * and `isValidOrder` would then reject those orders — every sale after
 * the import would vanish from the Orders screen and from the day's
 * takings. A hundred million orders is several lifetimes of this bakery.
 */
export const MAX_ORDER_NUMBER = 100_000_000

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
 *
 * The name and price bounds are Admin's own (`MAX_PRODUCT_NAME_LENGTH`,
 * `MAX_PRODUCT_PRICE`): an import must not be a side door to a product
 * the add/edit form would refuse — a ฿2,000,000 croissant, or a name that
 * doesn't fit a tile on a phone.
 */
function productProblem(value: unknown): string | null {
  if (!isPlainObject(value)) return 'is not an object'
  const { id, name, price, category, sortOrder, archived, outOfStock } = value
  if (typeof id !== 'string' || id.length === 0) return 'has no id'
  if (typeof name !== 'string' || name.trim().length === 0) return 'has no name'
  if (name.length > MAX_PRODUCT_NAME_LENGTH) return 'has a name that is too long'
  if (!Number.isSafeInteger(price) || (price as number) < 0) {
    return 'has a price that is not whole satang'
  }
  if ((price as number) > MAX_PRODUCT_PRICE) return 'costs more than Admin allows'
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
 * - `number` no higher than `MAX_ORDER_NUMBER`, so the import can't break
 *   the numbering of every sale that comes after it
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
  if (value.number > MAX_ORDER_NUMBER) return 'has an order number that is out of range'
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
export function readExportedSettings(value: unknown): ExportedSettings {
  const settings = coerceSettings(value)
  return {
    shopName: settings.shopName,
    promptPayId: settings.promptPayId,
    categoryOrder: [...settings.categoryOrder],
  }
}

/** One shop setting an import would overwrite, with both values to show. */
export interface SettingsChange {
  field: string
  from: string
  to: string
}

/** One product's price move, in satang — the screen formats it. */
export interface PriceChange {
  id: string
  name: string
  from: Satang
  to: Satang
}

/**
 * What importing `incoming` would change about the shop settings, field
 * by field, with the value it would replace.
 *
 * This exists so the confirmation can *name* what is about to move.
 * Replacing a PromptPay ID is the worst silent change in the app: restore
 * a July backup in September to recover some orders, and every PromptPay
 * sale afterwards pays the account the shop closed in June, with nothing
 * on screen having said so.
 */
export function settingsChanges(
  current: ExportedSettings,
  incoming: ExportedSettings,
): SettingsChange[] {
  const changes: SettingsChange[] = []
  if (current.shopName !== incoming.shopName) {
    changes.push({ field: 'Shop name', from: current.shopName, to: incoming.shopName })
  }
  if (current.promptPayId !== incoming.promptPayId) {
    changes.push({ field: 'PromptPay ID', from: current.promptPayId, to: incoming.promptPayId })
  }
  const order = (categories: Category[]) => categories.map(categoryLabel).join(', ')
  if (order(current.categoryOrder) !== order(incoming.categoryOrder)) {
    changes.push({
      field: 'Category order',
      from: order(current.categoryOrder),
      to: order(incoming.categoryOrder),
    })
  }
  return changes
}

/**
 * Whether two products are the same in every field an import would write.
 * Used to tell "already here and identical" from "already here and about
 * to be replaced" — a difference the owner has to see before it happens,
 * because replacing a product changes what the Sell grid charges.
 */
export function sameProduct(a: Product, b: Product): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.price === b.price &&
    a.category === b.category &&
    a.sortOrder === b.sortOrder &&
    a.outOfStock === b.outOfStock &&
    a.archived === b.archived
  )
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
  if (typeof text !== 'string') return reject('empty', 'That file is empty.')
  // Length before `trim()`: trimming a huge string copies it, and the
  // point of this check is not to touch a huge string at all.
  if (text.length > MAX_IMPORT_CHARS) return reject('too-large', TOO_LARGE_MESSAGE)
  if (text.trim().length === 0) return reject('empty', 'That file is empty.')

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
