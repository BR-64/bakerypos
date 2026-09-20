/**
 * App-wide configuration. Everything here is a placeholder until task 7
 * moves it into a `settings` table in Dexie, editable from the Admin screen.
 */

/**
 * An obviously-fake PromptPay ID (it fails no validation — it's a
 * well-formed 10-digit ID — but no real bank account uses it). Compared
 * against directly (not against `PROMPTPAY_ID`) to decide whether to show
 * PromptPayScreen's "not a real account" warning, so that warning still
 * disappears correctly once the owner edits `PROMPTPAY_ID` below to their
 * real number (until task 7 moves this into a settings screen).
 */
export const PLACEHOLDER_PROMPTPAY_ID = '0000000000'

/** Digits only. See `PLACEHOLDER_PROMPTPAY_ID` above. */
export const PROMPTPAY_ID: string = PLACEHOLDER_PROMPTPAY_ID
