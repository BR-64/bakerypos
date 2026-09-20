/** Half-open ISO range covering one local calendar day: [startISO, endISO). */
export interface LocalDayRange {
  /** ISO instant of local midnight at the start of the day containing `now`. */
  startISO: string
  /** ISO instant of local midnight at the start of the *next* local day (exclusive). */
  endISO: string
}

/**
 * The local calendar day containing `now`, as a half-open ISO range suitable
 * for `where('createdAt').between(startISO, endISO, true, false)` (see
 * `src/db/orders.ts` `todaysOrders`).
 *
 * The end boundary is computed with `end.setDate(end.getDate() + 1)`, not
 * `+ 86_400_000`: on a day with a DST transition, the local day is 23 or 25
 * hours long, and adding a fixed number of milliseconds would land on the
 * wrong local midnight (off by an hour) or even the wrong calendar day.
 * `setDate` always lands on "the same local wall-clock time, one calendar
 * day later", which is what "today" means to the person running the till.
 */
export function localDayRange(now: Date = new Date()): LocalDayRange {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const end = new Date(start)
  end.setDate(end.getDate() + 1)
  return { startISO: start.toISOString(), endISO: end.toISOString() }
}

/**
 * Format an ISO timestamp as a local 24-hour clock time, e.g. "14:05".
 * `Intl`'s default locale follows the environment (the browser, or CI's
 * container), which would make the same order show a different time format
 * (e.g. "2:05 PM") depending on where the app happens to run — pinning
 * `'en-GB'` keeps the shape fixed to zero-padded 24-hour "HH:mm" everywhere,
 * while the actual hour/minute still reflect the device's local timezone.
 */
export function formatLocalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
