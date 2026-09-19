import type { CashPayment, Satang } from './types'
import { changeDue } from './money'

/**
 * Whole-baht keypad entry: what staff have typed so far for cash tendered,
 * kept as a string of digits (baht only — a satang total that isn't a whole
 * baht amount is paid with the "Exact" quick-tender button instead, never
 * typed digit-by-digit). `''` means nothing has been typed yet.
 */
export type TenderEntry = string

/** Keypad entry never grows past this many digits (฿999,999 is plenty for a bakery till). */
const MAX_DIGITS = 6

/**
 * Append a digit key press to the current entry. Any input that isn't a
 * single "0"-"9" character (there is no "." key) is ignored, returning
 * `entry` unchanged. Leading zeros are dropped as they're typed — "0" then
 * "5" gives "5", not "05" — and typing "0" while the entry is empty leaves
 * it empty rather than becoming "0". A 7th digit is ignored, so the entry
 * never exceeds `MAX_DIGITS`.
 */
export function pressDigit(entry: TenderEntry, digit: string): TenderEntry {
  if (!/^[0-9]$/.test(digit)) return entry
  const candidate = (entry + digit).replace(/^0+(?=\d)/, '').replace(/^0+$/, '')
  return candidate.length > MAX_DIGITS ? entry : candidate
}

/** Remove the last digit typed, if any. A no-op on an already-empty entry. */
export function deleteDigit(entry: TenderEntry): TenderEntry {
  return entry.slice(0, -1)
}

/** The entry as integer satang tendered, e.g. "120" (baht) -> 12000 (satang). */
export function entryToSatang(entry: TenderEntry): Satang {
  return entry === '' ? 0 : Number(entry) * 100
}

/**
 * Build the `CashPayment` for a completed sale, or `null` when the amount
 * handed over is still short of the total. Callers must treat `null` as
 * "can't complete yet" rather than ever calling `changeDue` themselves with
 * too little — this is the only place `changeDue` is called for a cash sale.
 */
export function cashPayment(total: Satang, tendered: Satang): CashPayment | null {
  if (tendered < total) return null
  return { method: 'cash', tendered, change: changeDue(total, tendered) }
}
