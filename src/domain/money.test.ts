import { describe, expect, it } from 'vitest'
import { bahtToSatang, cartTotal, changeDue, formatBaht, quickTenderOptions } from './money'

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
