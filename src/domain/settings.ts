import { CATEGORY_ORDER, isKnownCategory } from './categories'
import { isPinHash, isPinSalt } from './pin'
import { isValidPromptPayId, PLACEHOLDER_PROMPTPAY_ID } from './promptpay'
import type { Category } from './types'

/**
 * Primary key of the one settings row. The table is a singleton keyed by
 * `id` (see `src/db/db.ts`'s `.version(2)` block) rather than a free-form
 * key/value store, so reading it is a single `get` and writing it is a
 * single `put` — no partial row can ever exist.
 */
export const SETTINGS_ID = 'shop'

/** Shop-wide settings, editable from the Admin screen (task 7b). */
export interface Settings {
  /** Always `SETTINGS_ID`. */
  id: string
  /** Shown on the Z report header and in the shared/copied report text. */
  shopName: string
  /** Digits only — the account the PromptPay QR pays. See `./promptpay.ts`. */
  promptPayId: string
  /**
   * Category tab order on the Sell screen, editable from Admin. Always a
   * full permutation of `CATEGORY_ORDER` (`coerceSettings` fills in
   * anything missing), so a category can never disappear from the tabs
   * because it was left out of a stored order.
   */
  categoryOrder: Category[]
  /**
   * Salted SHA-256 of the Admin PIN (`src/domain/pin.ts`), or `null` when
   * no PIN has been set yet — the first-run set-PIN flow. Never the PIN
   * itself: nothing anywhere stores a PIN in plain text.
   */
  pinHash: string | null
  /** The salt `pinHash` was computed with. `null` exactly when `pinHash` is. */
  pinSalt: string | null
  /**
   * Salted SHA-256 (same salt) of the one-time recovery code shown when
   * the PIN was set. `null` when no PIN is set, or when the stored value
   * was unusable — the PIN still works then, only recovery is gone.
   */
  recoveryHash: string | null
  /**
   * When the PIN keypad's 60-second lockout ends (`Date.now()` epoch
   * milliseconds), or `null` when nothing is locked out.
   *
   * Stored rather than kept in memory so that force-quitting the app
   * isn't a way around five wrong guesses. It is an ordinary unindexed
   * field, so it needs no new Dexie version — but it does need handling
   * here, or `saveSettings` would drop it on every write.
   *
   * Only shape is checked here (a positive safe integer). Whether a
   * deadline is one worth honouring is a question about *now*, and lives
   * in `usableLockoutDeadline` (`./pin.ts`), which refuses anything more
   * than one lockout away so a corrupt or far-future value can never lock
   * the owner out for good.
   */
  lockedUntil: number | null
}

/**
 * What the app uses when there is no settings row yet, when the stored row
 * is corrupt, or when reading it fails. `src/db/seed.ts` deliberately does
 * *not* seed a row: `seedIfEmpty` short-circuits on a non-empty products
 * table, so a device upgraded from schema v1 would never get one anyway.
 * The first Admin save (task 7b) creates it.
 *
 * `promptPayId` is the obviously-fake placeholder, so the PromptPay screen
 * keeps showing its "Test PromptPay ID — not a real account" warning until
 * the owner enters a real one.
 */
export const DEFAULT_SETTINGS: Settings = {
  id: SETTINGS_ID,
  shopName: 'Bakery',
  promptPayId: PLACEHOLDER_PROMPTPAY_ID,
  // A copy, never the exported `CATEGORY_ORDER` array itself: anything
  // that reordered this default in place would silently reorder the
  // constant every other caller reads.
  categoryOrder: [...CATEGORY_ORDER],
  // No default PIN (SPEC): a device with no stored hash shows the
  // first-run set-PIN flow instead of accepting some well-known number.
  pinHash: null,
  pinSalt: null,
  recoveryHash: null,
  // Nothing is locked out on a device that has never been used.
  lockedUntil: null,
}

/** Longest shop name Admin accepts — it has to fit a phone-width report header. */
export const MAX_SHOP_NAME_LENGTH = 40

function isValidShopName(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_SHOP_NAME_LENGTH
  )
}

function isStoredPromptPayId(value: unknown): value is string {
  return typeof value === 'string' && isValidPromptPayId(value)
}

/**
 * A stored category order, repaired into a full permutation of
 * `CATEGORY_ORDER`: unknown or duplicated entries are dropped and any
 * category the stored value left out is appended in the default order.
 * Always a fresh array, never the shared `CATEGORY_ORDER` constant.
 */
function coerceCategoryOrder(value: unknown): Category[] {
  const raw = Array.isArray(value) ? value : []
  const order: Category[] = []
  for (const entry of raw) {
    if (isKnownCategory(entry) && !order.includes(entry)) order.push(entry)
  }
  for (const category of CATEGORY_ORDER) {
    if (!order.includes(category)) order.push(category)
  }
  return order
}

/**
 * The three PIN fields, coerced together.
 *
 * `pinHash` and `pinSalt` are a **pair**: a hash without its salt (or with
 * a corrupt one) can never match anything, so keeping one without the
 * other would leave Admin permanently unopenable with no way back. Both go
 * to `null` together, which returns the device to the first-run set-PIN
 * flow — the same place a brand-new device starts.
 *
 * `recoveryHash` is only meaningful alongside a PIN (it exists to reset
 * one), so it is dropped whenever the pair is. A corrupt `recoveryHash` on
 * its own, though, does **not** clear the PIN: the lock keeps working and
 * only the recovery route is gone.
 */
function coercePinFields(
  raw: Record<string, unknown>,
): Pick<Settings, 'pinHash' | 'pinSalt' | 'recoveryHash'> {
  if (!isPinHash(raw.pinHash) || !isPinSalt(raw.pinSalt)) {
    return { pinHash: null, pinSalt: null, recoveryHash: null }
  }
  return {
    pinHash: raw.pinHash,
    pinSalt: raw.pinSalt,
    recoveryHash: isPinHash(raw.recoveryHash) ? raw.recoveryHash : null,
  }
}

/**
 * A stored lockout deadline, kept only if it is shaped like one: a
 * positive safe integer of epoch milliseconds. Whether it is still worth
 * honouring is `usableLockoutDeadline`'s job, not this one's — coercion
 * must not depend on what time it is, or a row would stop being "valid"
 * merely because a minute went by.
 */
function coerceLockedUntil(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null
}

function sameOrder(a: unknown, b: Category[]): boolean {
  return Array.isArray(a) && a.length === b.length && b.every((c, i) => a[i] === c)
}

/**
 * Whether `value` is a settings row we can use as-is. Equivalent to
 * "`coerceSettings(value)` would change nothing", which is what makes the
 * two safe to reason about together.
 *
 * `value` is `unknown`, not `Settings`: a row read back from Dexie is
 * untrusted (CLAUDE.md), so this must never throw for `null`, an array, a
 * BigInt or anything else a hand-edited record could hold.
 */
export function isValidSettings(value: unknown): value is Settings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const s = value as Record<string, unknown>
  const pin = coercePinFields(s)
  return (
    s.id === SETTINGS_ID &&
    isValidShopName(s.shopName) &&
    isStoredPromptPayId(s.promptPayId) &&
    sameOrder(s.categoryOrder, coerceCategoryOrder(s.categoryOrder)) &&
    s.pinHash === pin.pinHash &&
    s.pinSalt === pin.pinSalt &&
    s.recoveryHash === pin.recoveryHash &&
    s.lockedUntil === coerceLockedUntil(s.lockedUntil)
  )
}

/**
 * Turn any value into a usable `Settings`, correcting it **field by
 * field** and never throwing.
 *
 * Field by field is the whole point: a corrupt `shopName` must not drag a
 * perfectly good, real `promptPayId` back to the placeholder (which would
 * make the checkout show a QR for nobody's account, plus a "test ID"
 * warning, because one unrelated string went bad). Conversely a corrupt
 * `promptPayId` falls back to the placeholder — never to a guess — so the
 * warning is shown rather than a QR built from junk.
 *
 * **Contract for future fields:** every field added to `Settings` must
 * also be handled here. `saveSettings` (`src/db/settings.ts`) writes
 * `coerceSettings(input)`, so a field this function doesn't copy across is
 * silently dropped on every save.
 */
export function coerceSettings(value: unknown): Settings {
  const raw =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {}
  return {
    id: SETTINGS_ID,
    shopName: isValidShopName(raw.shopName) ? raw.shopName : DEFAULT_SETTINGS.shopName,
    promptPayId: isStoredPromptPayId(raw.promptPayId)
      ? raw.promptPayId
      : DEFAULT_SETTINGS.promptPayId,
    categoryOrder: coerceCategoryOrder(raw.categoryOrder),
    ...coercePinFields(raw),
    lockedUntil: coerceLockedUntil(raw.lockedUntil),
  }
}
