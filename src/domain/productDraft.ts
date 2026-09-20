import { isKnownCategory } from './categories'
import { parseBahtInput } from './money'
import type { Category, Satang } from './types'

/**
 * Validation for the Admin screen's add/edit product form. Pure — no
 * React, no Dexie — so every rule below is unit-tested directly.
 *
 * The form holds strings (that's what an `<input>` gives you); this turns
 * them into the typed, integer-satang values `src/db/products.ts` writes,
 * or into one staff-facing message explaining what to fix. Nothing
 * half-valid ever reaches the database: a product's price is snapshotted
 * onto every future order line, so "฿4 5" must be a refusal, never a guess.
 */

/** Longest product name Admin accepts — it has to fit a tile on a phone. */
export const MAX_PRODUCT_NAME_LENGTH = 40

/**
 * Most expensive product Admin accepts: ฿100,000. Well inside
 * `Number.MAX_SAFE_INTEGER` even multiplied by a large quantity, so a
 * mistyped price can never make a cart total unsafe.
 */
export const MAX_PRODUCT_PRICE: Satang = 100_000_00

/** The raw form fields, exactly as typed. */
export interface ProductDraft {
  name: string
  /** Baht as typed, e.g. `"55"` or `"45.50"`. */
  price: string
  category: string
}

/** What a valid draft becomes: the fields `createProduct`/`updateProduct` take. */
export interface ProductValues {
  name: string
  price: Satang
  category: Category
}

export type ProductDraftResult = { ok: true; values: ProductValues } | { ok: false; error: string }

/**
 * Validate one add/edit form submission.
 *
 * Returns the first problem only: the form shows one message under the
 * fields, and a list of everything wrong at once is noise on a phone.
 */
export function validateProductDraft(draft: ProductDraft): ProductDraftResult {
  const name = typeof draft.name === 'string' ? draft.name.trim() : ''
  if (name.length === 0) return { ok: false, error: 'Enter a product name.' }
  if (name.length > MAX_PRODUCT_NAME_LENGTH) {
    return { ok: false, error: `Name must be ${MAX_PRODUCT_NAME_LENGTH} characters or fewer.` }
  }

  const price = parseBahtInput(typeof draft.price === 'string' ? draft.price : '')
  if (price === null) {
    return { ok: false, error: 'Enter a price in baht, e.g. 45 or 45.50.' }
  }
  if (price > MAX_PRODUCT_PRICE) {
    return { ok: false, error: 'That price looks wrong — ฿100,000 is the most Admin accepts.' }
  }

  if (!isKnownCategory(draft.category)) {
    return { ok: false, error: 'Choose a category.' }
  }

  return { ok: true, values: { name, price, category: draft.category } }
}
