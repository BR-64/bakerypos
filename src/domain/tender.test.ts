import { describe, expect, it } from 'vitest'
import { cashPayment, deleteDigit, entryToSatang, pressDigit } from './tender'

describe('pressDigit', () => {
  it('appends digits to build up an entry', () => {
    expect(pressDigit('', '1')).toBe('1')
    expect(pressDigit('1', '2')).toBe('12')
    expect(pressDigit('12', '5')).toBe('125')
  })

  it('ignores anything that is not a single 0-9 character', () => {
    expect(pressDigit('12', '.')).toBe('12')
    expect(pressDigit('12', 'a')).toBe('12')
    expect(pressDigit('12', '10')).toBe('12')
    expect(pressDigit('12', '')).toBe('12')
    expect(pressDigit('12', '-')).toBe('12')
  })

  it('drops leading zeros as they are typed', () => {
    expect(pressDigit('', '0')).toBe('')
    expect(pressDigit('', '0')).not.toBe('0')
    expect(pressDigit(pressDigit('', '0'), '5')).toBe('5')
  })

  it('caps the entry at 6 digits, ignoring a 7th', () => {
    const six = '123456'
    expect(pressDigit(six, '7')).toBe(six)
  })
})

describe('deleteDigit', () => {
  it('removes the last digit typed', () => {
    expect(deleteDigit('123')).toBe('12')
    expect(deleteDigit('1')).toBe('')
  })

  it('is a no-op on an empty entry', () => {
    expect(deleteDigit('')).toBe('')
  })
})

describe('entryToSatang', () => {
  it('converts whole-baht digits to satang', () => {
    expect(entryToSatang('')).toBe(0)
    expect(entryToSatang('1')).toBe(100)
    expect(entryToSatang('120')).toBe(12000)
    expect(entryToSatang('999999')).toBe(99999900)
  })
})

describe('cashPayment', () => {
  it('returns null when tendered is short of the total, without calling changeDue', () => {
    expect(cashPayment(4500, 4000)).toBeNull()
    expect(cashPayment(4500, 0)).toBeNull()
  })

  it('returns the payment with the correct change when tendered covers the total', () => {
    expect(cashPayment(4500, 4500)).toEqual({ method: 'cash', tendered: 4500, change: 0 })
    expect(cashPayment(4500, 5000)).toEqual({ method: 'cash', tendered: 5000, change: 500 })
  })

  it('handles an exact ฿0 cart (free items)', () => {
    expect(cashPayment(0, 0)).toEqual({ method: 'cash', tendered: 0, change: 0 })
  })
})
