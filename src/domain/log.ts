/**
 * Turns an arbitrary, possibly-corrupt value into a string for a log
 * message, without ever throwing. Product/order records read back from
 * IndexedDB are not guaranteed to match their TypeScript types (a
 * hand-edited or corrupted record can hold anything), so building a log
 * message out of one — even just to report that it's invalid — must not
 * itself be able to crash the screen. Handles the values that make naive
 * string conversion throw: BigInt and Symbol convert fine with
 * `String()`, but `JSON.stringify` doesn't (throws on BigInt) and a
 * circular object throws on both `JSON.stringify` and template-literal
 * conversion of some hosts' inspection helpers — so this always falls back
 * to a safe constant instead of ever letting a logging call throw.
 */
export function safeString(value: unknown): string {
  try {
    if (typeof value === 'bigint') return `${value}n`
    if (typeof value === 'symbol' || typeof value === 'function') return String(value)
    if (typeof value === 'string') return value
    if (value === null || value === undefined) return String(value)
    if (typeof value !== 'object') return String(value)
    return JSON.stringify(value, (_key, v) => (typeof v === 'bigint' ? `${v}n` : v))
  } catch {
    return '[unserializable value]'
  }
}
