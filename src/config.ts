/**
 * App-wide configuration. Everything here is a placeholder until task 7
 * moves it into a `settings` table in Dexie, editable from the Admin screen.
 */

/**
 * Digits only. `'0000000000'` is an obviously-fake placeholder (it fails no
 * validation — it's a well-formed 10-digit ID — but no real bank account
 * uses it), so PromptPayScreen shows a "not a real account" warning while
 * it's in use.
 */
export const PROMPTPAY_ID = '0000000000'
