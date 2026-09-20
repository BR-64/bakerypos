import { PLACEHOLDER_PROMPTPAY_ID } from '../config'
import { isValidPromptPayId } from './promptpay'

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
}

function isValidShopName(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isStoredPromptPayId(value: unknown): value is string {
  return typeof value === 'string' && isValidPromptPayId(value)
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
  return s.id === SETTINGS_ID && isValidShopName(s.shopName) && isStoredPromptPayId(s.promptPayId)
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
  }
}
