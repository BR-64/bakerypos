import { describe, expect, it } from 'vitest'
import { safeString } from './log'

describe('safeString', () => {
  it('returns strings unchanged', () => {
    expect(safeString('Croissant')).toBe('Croissant')
    expect(safeString('')).toBe('')
  })

  it('stringifies plain values', () => {
    expect(safeString(55)).toBe('55')
    expect(safeString(true)).toBe('true')
    expect(safeString(null)).toBe('null')
    expect(safeString(undefined)).toBe('undefined')
  })

  it('never throws for a BigInt, even nested in an object', () => {
    expect(() => safeString(10n)).not.toThrow()
    expect(safeString(10n)).toBe('10n')

    expect(() => safeString({ name: 'X', price: 10n })).not.toThrow()
    expect(safeString({ name: 'X', price: 10n })).toContain('10n')
  })

  it('never throws for a circular object', () => {
    const obj: Record<string, unknown> = { name: 'X' }
    obj.self = obj

    expect(() => safeString(obj)).not.toThrow()
    expect(typeof safeString(obj)).toBe('string')
  })

  it('never throws for a Symbol', () => {
    expect(() => safeString(Symbol('mystery'))).not.toThrow()
  })

  it('never throws for a function', () => {
    expect(() => safeString(() => {})).not.toThrow()
  })
})
