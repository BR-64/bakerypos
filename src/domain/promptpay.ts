import generatePayload from 'promptpay-qr'
import type { Satang } from './types'

/**
 * A PromptPay ID is either a 10-digit mobile number starting with `0`, or a
 * 13-digit national/tax ID. Digits only — no dashes, spaces, a leading `+`,
 * or non-ASCII (e.g. Thai) digits. This is a deliberate fail-closed choice:
 * `\d` only ever matches ASCII 0-9, so anything a human might type that
 * *looks* like a valid ID but isn't exactly digits is rejected rather than
 * silently building a QR for the wrong recipient.
 */
export function isValidPromptPayId(id: string): boolean {
  if (!/^\d+$/.test(id)) return false
  if (id.length === 10) return id.startsWith('0')
  return id.length === 13
}

/**
 * Format satang as a baht amount with exactly two decimals, e.g.
 * 11000 -> "110.00", 4550 -> "45.50", 5 -> "0.05". Integer maths only —
 * never floating-point division — so it can be trusted to check what
 * `promptpay-qr` (which does divide as a float) actually emits.
 */
export function formatPromptPayAmount(total: Satang): string {
  if (!Number.isSafeInteger(total)) {
    throw new Error('PromptPay amount must be an integer number of satang')
  }
  const baht = Math.floor(total / 100)
  const satang = total % 100
  return `${baht}.${String(satang).padStart(2, '0')}`
}

/**
 * True if `total` can be formatted and fits in the payload's amount field —
 * false for anything that can't even be formatted (e.g. not a safe integer,
 * including a fractional total) as well as one that's simply too long.
 * `cart.total` is derived from Dexie product prices, which CLAUDE.md treats
 * as untrusted, so a checkout screen calls this *before* `promptPayPayload`
 * to decide whether to build a QR at all, rather than relying on catching
 * that function's throw during render.
 */
export function canEncodePromptPayAmount(total: Satang): boolean {
  try {
    return formatPromptPayAmount(total).length <= 13
  } catch {
    return false
  }
}

/**
 * Read one top-level EMV QR TLV field (2-digit ID, 2-digit length, value)
 * out of a payload built by `generatePayload`. Walking sequentially from the
 * start — rather than searching for the field ID as a substring — means a
 * coincidental "54" inside an earlier field's value (e.g. the merchant
 * account info block) can never be mistaken for the amount field.
 */
function extractField(payload: string, fieldId: string): string | undefined {
  let pos = 0
  while (pos + 4 <= payload.length) {
    const id = payload.slice(pos, pos + 2)
    const length = Number(payload.slice(pos + 2, pos + 4))
    const value = payload.slice(pos + 4, pos + 4 + length)
    if (id === fieldId) return value
    pos += 4 + length
  }
  return undefined
}

/**
 * Build a PromptPay QR payload for `total` satang to `id`.
 *
 * Throws — rather than handing back a QR with the wrong (or no) amount —
 * for: an invalid ID; a total that isn't a positive, safe integer number of
 * satang (`total <= 0` would make `promptpay-qr` emit a static, amount-less
 * QR); an amount too long to fit the payload's amount field; or, as a last
 * check, a generated payload whose field 54 doesn't exactly equal the
 * integer-built amount (guards against float drift in `promptpay-qr`'s own
 * `(total / 100).toFixed(2)`).
 */
export function promptPayPayload(id: string, total: Satang): string {
  if (!isValidPromptPayId(id)) {
    throw new Error('Invalid PromptPay ID')
  }
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error('PromptPay total must be a positive integer number of satang')
  }
  const amount = formatPromptPayAmount(total)
  if (amount.length > 13) {
    throw new Error('PromptPay amount is too large')
  }

  const payload = generatePayload(id, { amount: total / 100 })
  if (extractField(payload, '54') !== amount) {
    throw new Error('Generated PromptPay payload amount does not match the requested total')
  }
  return payload
}
