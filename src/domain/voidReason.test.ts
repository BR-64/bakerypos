import { describe, expect, it } from 'vitest'
import { MAX_VOID_REASON_LENGTH, normalizeVoidReason, VOID_REASONS } from './voidReason'

describe('VOID_REASONS', () => {
  it('is a non-empty list of distinct, non-empty strings including an "Other…" option', () => {
    expect(VOID_REASONS.length).toBeGreaterThan(0)
    expect(new Set(VOID_REASONS).size).toBe(VOID_REASONS.length)
    for (const reason of VOID_REASONS) {
      expect(typeof reason).toBe('string')
      expect(reason.trim().length).toBeGreaterThan(0)
    }
    expect(VOID_REASONS).toContain('Other')
  })
})

describe('normalizeVoidReason', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeVoidReason('  Customer changed their mind  ')).toBe(
      'Customer changed their mind',
    )
  })

  it.each(['', '   ', '\t\n'])('returns null for an empty-after-trim reason %j', (reason) => {
    expect(normalizeVoidReason(reason)).toBeNull()
  })

  it('caps length at MAX_VOID_REASON_LENGTH', () => {
    const long = 'x'.repeat(MAX_VOID_REASON_LENGTH + 50)
    const result = normalizeVoidReason(long)
    expect(result).toHaveLength(MAX_VOID_REASON_LENGTH)
    expect(result).toBe('x'.repeat(MAX_VOID_REASON_LENGTH))
  })

  it('trims again if the length cap lands mid-whitespace', () => {
    const long = 'x'.repeat(MAX_VOID_REASON_LENGTH - 1) + '   trailing text cut off here'
    const result = normalizeVoidReason(long)
    expect(result).toBe('x'.repeat(MAX_VOID_REASON_LENGTH - 1))
  })

  it('leaves a reason at exactly the max length untouched', () => {
    const exact = 'y'.repeat(MAX_VOID_REASON_LENGTH)
    expect(normalizeVoidReason(exact)).toBe(exact)
  })

  it('accepts a normal preset reason unchanged', () => {
    expect(normalizeVoidReason('Duplicate order')).toBe('Duplicate order')
  })
})
