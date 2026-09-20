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
 * The local calendar day of `date` as a `YYYY-MM-DD` key — the exact
 * format `<input type="date">` uses for its `value`/`max`, and the string
 * the Z report keys its query on.
 *
 * Built from the **local** parts (`getFullYear`/`getMonth`/`getDate`),
 * never `toISOString().slice(0, 10)`: `toISOString` converts to UTC first,
 * so at 07:00 in Bangkok (UTC+7) it would hand back *yesterday's* date and
 * the till would open on the wrong day's takings every morning.
 */
export function localDayKey(date: Date = new Date()): string {
  const year = String(date.getFullYear()).padStart(4, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * The inverse of `localDayKey`: local midnight at the start of that day,
 * or `null` if `key` isn't a real `YYYY-MM-DD` date.
 *
 * Uses the `new Date(year, monthIndex, day)` constructor, never
 * `new Date('2026-01-15')` — the string form is parsed as *UTC midnight*
 * by the spec, which in Bangkok is 07:00 on the 15th and in New York
 * 19:00 on the 14th, i.e. the wrong day outright for any negative offset.
 *
 * Returning `null` (rather than an Invalid Date, or a silently rolled-over
 * one) matters because the value comes from an `<input type="date">`,
 * which on some browsers lets a person type any digits at all: `2026-02-31`
 * would otherwise roll over to March 3rd and report a day nobody asked
 * for. The round-trip check below rejects exactly that, along with the
 * years 0-99, which the two-argument-and-up `Date` constructor maps into
 * 1900-1999.
 */
export function parseLocalDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(year, month - 1, day)
  const roundTrips =
    date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
  return roundTrips ? date : null
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
