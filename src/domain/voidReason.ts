/**
 * Quick-pick reasons offered on the void panel (see `src/screens/
 * OrdersScreen.tsx`), plus a free-text "Other…" option. Order here is
 * display order only.
 */
export const VOID_REASONS = [
  'Customer changed their mind',
  'Ordered by mistake',
  'Duplicate order',
  'Wrong item or price',
  'Other',
] as const

export type VoidReason = (typeof VOID_REASONS)[number]

/** A void reason (including free "Other…" text) is capped at this many characters. */
export const MAX_VOID_REASON_LENGTH = 80

/**
 * Normalize a void reason before it's stored: trims leading/trailing
 * whitespace, then requires the result to be non-empty and no longer than
 * `MAX_VOID_REASON_LENGTH` characters — returning `null` for either failure,
 * rather than silently truncating an over-length reason. Truncating would
 * quietly store something other than what staff actually typed; returning
 * `null` instead means the Orders screen's "Yes, void" simply stays
 * disabled (the same case as an empty reason) until it's short enough,
 * exactly like every other "not valid yet" state in this codebase.
 */
export function normalizeVoidReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length === 0 || trimmed.length > MAX_VOID_REASON_LENGTH) return null
  return trimmed
}
