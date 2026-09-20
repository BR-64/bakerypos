import { describe, expect, it } from 'vitest'
import { formatLocalTime, localDayRange } from './day'

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
