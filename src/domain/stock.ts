import { partitionCartLines } from './cart'
import { safeString } from './log'
import type { CartLine, StockMovement, StockMovementKind } from './types'

/**
 * Stock tracking (task 8d) — pure. No React, no Dexie.
 *
 * The count lives on `Product.stock`; `StockMovement` rows are history
 * only. Everything that decides *whether* and *what* to write is here, so
 * `src/db/stock.ts` and `completeOrder`/`voidOrder` only carry out a plan
 * that has already been checked: a data problem is found before any write
 * and skipped, never thrown — stock must never be the reason a sale fails.
 */

/** What a product's stored `stock` means. */
export type StockReading =
  | { kind: 'untracked' }
  | { kind: 'tracked'; level: number }
  /** Present but unusable — treated exactly like untracked, and logged. */
  | { kind: 'invalid' }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Read the stock off a product row as stored, which may be anything.
 *
 * - no `stock` key (or `stock: undefined`, which is the same thing to
 *   every reader) → untracked
 * - a safe integer, including 0 and negatives → tracked
 * - anything else present — `NaN`, `1.5`, `'5'`, `1e300`, `null`, a
 *   BigInt — → invalid
 * - a "product" that isn't a plain object at all (`null`, an array, a
 *   BigInt) → invalid: there is no count to trust on it
 *
 * Never throws.
 */
export function readStock(product: unknown): StockReading {
  if (!isPlainObject(product)) return { kind: 'invalid' }
  const value = product.stock
  if (value === undefined) return { kind: 'untracked' }
  if (Number.isSafeInteger(value)) return { kind: 'tracked', level: value as number }
  return { kind: 'invalid' }
}

/** The largest count or delivery Admin's inputs accept. */
export const MAX_STOCK_INPUT = 100_000

export type StockInputResult = { ok: true; value: number } | { ok: false; error: string }

function parseWholeNumber(text: string, min: number, tooSmall: string): StockInputResult {
  const trimmed = typeof text === 'string' ? text.trim() : ''
  if (!/^\d+$/.test(trimmed)) return { ok: false, error: 'Enter a whole number, e.g. 12.' }
  // Length check first, so a 400-digit paste is refused without building
  // a number that has already lost its precision.
  const value = trimmed.length > 7 ? Infinity : Number(trimmed)
  if (value > MAX_STOCK_INPUT) {
    return {
      ok: false,
      error: `That looks wrong — ${MAX_STOCK_INPUT.toLocaleString('en-US')} is the most Admin accepts.`,
    }
  }
  if (value < min) return { ok: false, error: tooSmall }
  return { ok: true, value }
}

/** Admin's "Set count": digits only, 0 to `MAX_STOCK_INPUT`. */
export function parseStockCount(text: string): StockInputResult {
  return parseWholeNumber(text, 0, 'Enter a whole number, e.g. 12.')
}

/** Admin's "+ Received": digits only, 1 to `MAX_STOCK_INPUT`. */
export function parseReceivedQty(text: string): StockInputResult {
  return parseWholeNumber(text, 1, 'Enter how many arrived — at least 1.')
}

/**
 * Units sold per product in an order's lines. Only the lines the rest of
 * the app would count (`partitionCartLines`'s valid subset — the same rule
 * the cart, `completeOrder` and the Z report use) move stock. Never throws;
 * anything that isn't an array is no lines.
 */
export function saleQuantities(lines: unknown): Map<string, number> {
  const quantities = new Map<string, number>()
  if (!Array.isArray(lines)) return quantities
  for (const line of partitionCartLines(lines as CartLine[]).valid) {
    quantities.set(line.productId, (quantities.get(line.productId) ?? 0) + line.qty)
  }
  return quantities
}

/** A product whose stock was left alone because its data couldn't be trusted. */
export interface StockSkip {
  productId: string
  reason: string
}

export interface StockPlanInput {
  /** Each product id in `deltas` → its stored row (`undefined` if there is none). */
  rows: ReadonlyMap<string, unknown>
  /** Product id → signed change, e.g. `-2` for a sale of two. */
  deltas: ReadonlyMap<string, number>
  kind: StockMovementKind
  /** `createdAt` for every movement in this plan. */
  at: string
  /** Movement id generator (the db layer passes `uuid`). */
  newId: () => string
  orderId?: string
  orderNumber?: number
}

export interface StockUpdate {
  id: string
  stock: number
}

export interface StockPlan {
  /** `products.update(id, { stock })` for each. */
  updates: StockUpdate[]
  /** One movement per update, same order. */
  movements: StockMovement[]
  /** Products left untouched because of bad data — log these after commit. */
  skipped: StockSkip[]
}

/**
 * Work out every stock write for a sale or a void, before writing any.
 *
 * - untracked product → ignored silently (tracking is opt-in)
 * - row missing, row not an object, stock unreadable, a delta that isn't a
 *   safe integer, or a result outside the safe-integer range → `skipped`
 *   with a reason; nothing is written for that product
 * - otherwise one update and one movement
 *
 * Never throws.
 */
export function planStockChanges(input: StockPlanInput): StockPlan {
  const updates: StockUpdate[] = []
  const movements: StockMovement[] = []
  const skipped: StockSkip[] = []
  for (const [productId, delta] of input.deltas) {
    const row = input.rows.get(productId)
    if (row === undefined || row === null) {
      skipped.push({ productId, reason: 'product not found' })
      continue
    }
    const reading = readStock(row)
    if (reading.kind === 'untracked') continue
    if (reading.kind === 'invalid') {
      skipped.push({
        productId,
        reason: isPlainObject(row)
          ? `stock is unreadable (${safeString(row.stock)})`
          : 'product row is unreadable',
      })
      continue
    }
    if (!Number.isSafeInteger(delta)) {
      skipped.push({ productId, reason: `change is not a whole number (${safeString(delta)})` })
      continue
    }
    const level = reading.level + delta
    if (!Number.isSafeInteger(level)) {
      skipped.push({ productId, reason: 'count would leave the safe range' })
      continue
    }
    const movement: StockMovement = {
      id: input.newId(),
      productId,
      kind: input.kind,
      delta,
      level,
      previous: reading.level,
      createdAt: input.at,
    }
    if (input.orderId !== undefined) movement.orderId = input.orderId
    if (input.orderNumber !== undefined) movement.orderNumber = input.orderNumber
    updates.push({ id: productId, stock: level })
    movements.push(movement)
  }
  return { updates, movements, skipped }
}

export interface VoidStockDeltas {
  /** A `void` movement for this order already exists: add nothing back again. */
  alreadyVoided: boolean
  /** Product id → units to add back (the negated sum of its `sale` deltas). */
  deltas: Map<string, number>
  /** Sale movements that couldn't be read, so couldn't be reversed. */
  skipped: StockSkip[]
}

/**
 * What voiding an order adds back: exactly what its recorded `sale`
 * movements removed — nothing for a product sold while untracked, since
 * that sale wrote no movement. `movements` are the rows stored for this
 * order (any shape). A row reading `kind: 'void'` — even one otherwise
 * corrupt — means the add-back already happened; erring that way can
 * under-count but never adds the same sale back twice.
 */
export function voidStockDeltas(movements: unknown[]): VoidStockDeltas {
  const deltas = new Map<string, number>()
  const skipped: StockSkip[] = []
  if (movements.some((m) => isPlainObject(m) && m.kind === 'void')) {
    return { alreadyVoided: true, deltas, skipped }
  }
  for (const movement of movements) {
    if (isPlainObject(movement) && movement.kind !== 'sale') continue
    if (!isValidStockMovement(movement)) {
      const productId = isPlainObject(movement) ? safeString(movement.productId) : '(unknown)'
      skipped.push({ productId, reason: 'sale movement is unreadable, so it was not reversed' })
      continue
    }
    const sum = (deltas.get(movement.productId) ?? 0) - movement.delta
    if (!Number.isSafeInteger(sum)) {
      skipped.push({ productId: movement.productId, reason: 'add-back would leave the safe range' })
      continue
    }
    deltas.set(movement.productId, sum)
  }
  return { alreadyVoided: false, deltas, skipped }
}

const KINDS: readonly string[] = ['sale', 'void', 'set', 'received']

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * Whether a stored movement is safe to show and to reverse:
 *
 * - `id`, `productId` non-empty strings; `kind` one of the four
 * - `delta`, `level` safe integers; `previous` a safe integer or `null`
 * - `level === (previous ?? 0) + delta` — the row adds up
 * - `createdAt` a string that parses to an instant
 * - `sale`/`void`: `orderId` a non-empty string; `orderNumber`, when
 *   present, a safe integer ≥ 1. `set`/`received` may carry neither.
 *
 * `unknown` in, never throws.
 */
export function isValidStockMovement(value: unknown): value is StockMovement {
  if (!isPlainObject(value)) return false
  const { id, productId, kind, delta, level, previous, createdAt, orderId, orderNumber } = value
  if (!isNonEmptyString(id) || !isNonEmptyString(productId)) return false
  if (typeof kind !== 'string' || !KINDS.includes(kind)) return false
  if (!Number.isSafeInteger(delta) || !Number.isSafeInteger(level)) return false
  if (previous !== null && !Number.isSafeInteger(previous)) return false
  if (level !== ((previous as number | null) ?? 0) + (delta as number)) return false
  if (!isNonEmptyString(createdAt) || Number.isNaN(new Date(createdAt).getTime())) return false
  if (kind === 'sale' || kind === 'void') {
    if (!isNonEmptyString(orderId)) return false
  } else if (orderId !== undefined) {
    return false
  }
  if (orderNumber !== undefined) {
    if (kind !== 'sale' && kind !== 'void') return false
    if (!Number.isSafeInteger(orderNumber) || (orderNumber as number) < 1) return false
  }
  return true
}

export interface PartitionedStockMovements {
  valid: StockMovement[]
  invalid: unknown[]
}

/** Splits stored movements into readable and unreadable, keeping order. */
export function partitionStockMovements(movements: unknown[]): PartitionedStockMovements {
  const valid: StockMovement[] = []
  const invalid: unknown[] = []
  for (const movement of movements) {
    if (isValidStockMovement(movement)) valid.push(movement)
    else invalid.push(movement)
  }
  return { valid, invalid }
}

/** The Sell tile's informational count. `low` at zero or below — never disables the tile. */
export function stockLabel(level: number): { text: string; low: boolean } {
  return { text: `Stock: ${level}`, low: level <= 0 }
}
