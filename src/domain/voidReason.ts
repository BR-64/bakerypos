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
 * whitespace and caps it at `MAX_VOID_REASON_LENGTH` characters (trimming
 * again after the cut, in case it lands mid-whitespace).
 *
 * Returns `null` for a reason that's empty or whitespace-only once
 * trimmed, so a caller can treat "nothing meaningful was entered" as one
 * case — a void without a reason is never allowed, so the Orders screen
 * uses this `null` to keep "Yes, void" disabled.
 */
export function normalizeVoidReason(reason: string): string | null {
  const trimmed = reason.trim()
  if (trimmed.length === 0) return null
  return trimmed.slice(0, MAX_VOID_REASON_LENGTH).trim()
}
