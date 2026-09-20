import { describe, expect, it } from 'vitest'
import { formatLocalTime, localDayKey, localDayRange, parseLocalDayKey } from './day'

describe('localDayRange', () => {
  it('starts at local midnight of the given day', () => {
    const now = new Date(2026, 0, 15, 10, 30, 45, 500)
    const { startISO } = localDayRange(now)
    const start = new Date(startISO)
    expect(start.getFullYear()).toBe(2026)
    expect(start.getMonth()).toBe(0)
    expect(start.getDate()).toBe(15)
    expect(start.getHours()).toBe(0)
    expect(start.getMinutes()).toBe(0)
    expect(start.getSeconds()).toBe(0)
    expect(start.getMilliseconds()).toBe(0)
  })

  it('ends at local midnight of the next day, via setDate rather than +86400000', () => {
    const now = new Date(2026, 0, 15, 10, 30)
    const { endISO } = localDayRange(now)
    const end = new Date(endISO)
    expect(end.getFullYear()).toBe(2026)
    expect(end.getMonth()).toBe(0)
    expect(end.getDate()).toBe(16)
    expect(end.getHours()).toBe(0)
    expect(end.getMinutes()).toBe(0)
  })

  it('rolls over month and year boundaries', () => {
    const now = new Date(2025, 11, 31, 23, 59)
    const { startISO, endISO } = localDayRange(now)
    const start = new Date(startISO)
    const end = new Date(endISO)
    expect([start.getFullYear(), start.getMonth(), start.getDate()]).toEqual([2025, 11, 31])
    expect([end.getFullYear(), end.getMonth(), end.getDate()]).toEqual([2026, 0, 1])
  })

  it('is a true half-open range: end minus 1ms is still the same day, end itself is the next day', () => {
    const now = new Date(2026, 5, 1, 12, 0)
    const { endISO } = localDayRange(now)
    const end = new Date(endISO)
    const justBefore = new Date(end.getTime() - 1)
    expect(justBefore.getDate()).toBe(1)
    expect(end.getDate()).toBe(2)
  })

  it('defaults `now` to the current time', () => {
    const before = Date.now()
    const { startISO } = localDayRange()
    const after = Date.now()
    const start = new Date(startISO).getTime()
    expect(start).toBeLessThanOrEqual(before)
    expect(start).toBeGreaterThan(before - 24 * 60 * 60 * 1000)
    expect(start).toBeLessThanOrEqual(after)
  })
})

describe('formatLocalTime', () => {
  it('formats a local time as zero-padded 24-hour HH:mm regardless of the environment locale', () => {
    const date = new Date(2026, 0, 2, 14, 5)
    expect(formatLocalTime(date.toISOString())).toBe('14:05')
  })

  it('pads single-digit hours and minutes', () => {
    const date = new Date(2026, 0, 2, 9, 3)
    expect(formatLocalTime(date.toISOString())).toBe('09:03')
  })

  it('formats midnight as 00:00', () => {
    const date = new Date(2026, 0, 2, 0, 0)
    expect(formatLocalTime(date.toISOString())).toBe('00:00')
  })
})

describe('localDayKey', () => {
  it('formats the local calendar day as YYYY-MM-DD', () => {
    expect(localDayKey(new Date(2026, 0, 15, 10, 30))).toBe('2026-01-15')
  })

  it('zero-pads single-digit months and days', () => {
    expect(localDayKey(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05')
  })

  it('uses local parts, not UTC: late evening local is still today', () => {
    // 23:30 local on Jan 15. In any timezone east of UTC (e.g. Bangkok,
    // UTC+7) `toISOString().slice(0, 10)` would say 2026-01-15 here but
    // 2026-01-14 at 07:00 the same morning; the local-parts version is
    // stable across the whole day, which is what the check below pins.
    expect(localDayKey(new Date(2026, 0, 15, 23, 30))).toBe('2026-01-15')
    expect(localDayKey(new Date(2026, 0, 15, 0, 0))).toBe('2026-01-15')
    expect(localDayKey(new Date(2026, 0, 15, 7, 0))).toBe('2026-01-15')
  })

  it('defaults to now', () => {
    expect(localDayKey()).toBe(localDayKey(new Date()))
  })
})

describe('parseLocalDayKey', () => {
  it('returns local midnight at the start of that day', () => {
    const date = parseLocalDayKey('2026-01-15')
    expect(date).not.toBeNull()
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(0)
    expect(date?.getDate()).toBe(15)
    expect(date?.getHours()).toBe(0)
    expect(date?.getMinutes()).toBe(0)
    expect(date?.getSeconds()).toBe(0)
    expect(date?.getMilliseconds()).toBe(0)
  })

  it('never lands on the wrong day, as `new Date("2026-01-15")` (UTC midnight) would', () => {
    // The UTC-parsed form is the bug this guards: west of UTC it resolves
    // to the previous local day. Only assert the difference where the
    // environment's offset actually makes one, so the test is meaningful
    // in any timezone rather than accidentally passing in UTC.
    const parsed = parseLocalDayKey('2026-01-15')
    expect(parsed).not.toBeNull()
    const utcParsed = new Date('2026-01-15')
    if (utcParsed.getTimezoneOffset() !== 0) {
      expect(parsed?.getTime()).not.toBe(utcParsed.getTime())
    }
    expect(localDayKey(parsed as Date)).toBe('2026-01-15')
  })

  it.each([
    '2026-01-15',
    '2026-12-31',
    '2026-01-01',
    '2026-02-28',
    '2024-02-29',
    '2026-06-15',
    '2026-11-01',
  ])('round-trips %s through localDayKey in any timezone', (key) => {
    const date = parseLocalDayKey(key)
    expect(date).not.toBeNull()
    expect(localDayKey(date as Date)).toBe(key)
  })

  it('round-trips every day of a year, so no DST transition shifts the key', () => {
    let date = new Date(2026, 0, 1, 12, 0)
    for (let i = 0; i < 365; i++) {
      const key = localDayKey(date)
      expect(localDayKey(parseLocalDayKey(key) as Date)).toBe(key)
      date = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 12, 0)
    }
  })

  it.each([
    ['an empty string', ''],
    ['a non-date string', 'today'],
    ['an unpadded month', '2026-1-15'],
    ['a slashed date', '2026/01/15'],
    ['a full ISO instant', '2026-01-15T00:00:00.000Z'],
    ['a two-digit year', '26-01-15'],
    ['trailing text', '2026-01-15x'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-01-00'],
    ['day 32', '2026-01-32'],
    ['Feb 31st, which would silently roll over to March', '2026-02-31'],
    ['Feb 29th in a non-leap year', '2026-02-29'],
    ['a year the Date constructor would remap to the 1900s', '0099-01-15'],
  ])('returns null for %s', (_label, key) => {
    expect(parseLocalDayKey(key)).toBeNull()
  })
})
