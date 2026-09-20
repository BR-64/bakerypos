import { describe, expect, it } from 'vitest'
import {
  bahtToSatang,
  cartTotal,
  changeDue,
  formatBaht,
  formatBahtInput,
  parseBahtInput,
  quickTenderOptions,
} from './money'

describe('money', () => {
  it('converts baht to integer satang without float drift', () => {
    expect(bahtToSatang(45)).toBe(4500)
    expect(bahtToSatang(0.1 + 0.2)).toBe(30)
    expect(bahtToSatang(19.99)).toBe(1999)
  })

  it('formats satang as baht', () => {
    expect(formatBaht(4500)).toBe('฿45')
    expect(formatBaht(4550)).toBe('฿45.50')
    expect(formatBaht(105)).toBe('฿1.05')
    expect(formatBaht(0)).toBe('฿0')
    expect(formatBaht(123456700)).toBe('฿1,234,567')
    expect(formatBaht(-500)).toBe('-฿5')
  })

  it('sums a cart', () => {
    expect(cartTotal([])).toBe(0)
    expect(
      cartTotal([
        { unitPrice: 4500, qty: 2 },
        { unitPrice: 3500, qty: 1 },
      ]),
    ).toBe(12500)
  })

  it('computes change and rejects underpayment', () => {
    expect(changeDue(4500, 5000)).toBe(500)
    expect(changeDue(4500, 4500)).toBe(0)
    expect(() => changeDue(4500, 4000)).toThrow('Insufficient payment')
    expect(() => changeDue(45.5, 100)).toThrow('integer')
  })

  it('suggests quick tender amounts', () => {
    expect(quickTenderOptions(4500)).toEqual([4500, 5000, 10000, 50000])
    expect(quickTenderOptions(10000)).toEqual([10000, 50000, 100000])
    expect(quickTenderOptions(150000)).toEqual([150000])
  })
})

describe('parseBahtInput', () => {
  it('parses whole baht and one or two decimals as integer satang', () => {
    expect(parseBahtInput('45')).toBe(4500)
    expect(parseBahtInput('45.5')).toBe(4550)
    expect(parseBahtInput('45.50')).toBe(4550)
    expect(parseBahtInput('0')).toBe(0)
    expect(parseBahtInput('0.05')).toBe(5)
    expect(parseBahtInput(' 120 ')).toBe(12000)
  })

  it('never drifts the way a float multiply would', () => {
    // 19.99 * 100 is 1998.9999999999998 in binary floating point.
    expect(parseBahtInput('19.99')).toBe(1999)
    expect(parseBahtInput('0.29')).toBe(29)
    expect(parseBahtInput('8.03')).toBe(803)
  })

  it('rejects anything that is not a plain non-negative baht amount', () => {
    expect(parseBahtInput('')).toBeNull()
    expect(parseBahtInput('   ')).toBeNull()
    expect(parseBahtInput('-5')).toBeNull()
    expect(parseBahtInput('+5')).toBeNull()
    expect(parseBahtInput('45.555')).toBeNull()
    expect(parseBahtInput('45.')).toBeNull()
    expect(parseBahtInput('4 5')).toBeNull()
    expect(parseBahtInput('45฿')).toBeNull()
    expect(parseBahtInput('1e3')).toBeNull()
    expect(parseBahtInput('๔๕')).toBeNull()
    expect(parseBahtInput('9999999999')).toBeNull()
    // @ts-expect-error a form field can hand us anything
    expect(parseBahtInput(45)).toBeNull()
  })
})

describe('formatBahtInput', () => {
  it('round-trips through parseBahtInput', () => {
    for (const satang of [0, 5, 4500, 4550, 12000, 123456700]) {
      expect(parseBahtInput(formatBahtInput(satang))).toBe(satang)
    }
  })

  it('has no currency symbol or separators', () => {
    expect(formatBahtInput(5500)).toBe('55')
    expect(formatBahtInput(4550)).toBe('45.50')
    expect(formatBahtInput(105)).toBe('1.05')
  })

  it('returns an empty string for a corrupt stored price, rather than NaN', () => {
    expect(formatBahtInput(-1)).toBe('')
    expect(formatBahtInput(Number.NaN)).toBe('')
    expect(formatBahtInput(1e18)).toBe('')
  })
})
