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

  it('accepts a reason at exactly MAX_VOID_REASON_LENGTH, verbatim', () => {
    const exact = 'y'.repeat(MAX_VOID_REASON_LENGTH)
    expect(normalizeVoidReason(exact)).toBe(exact)
  })

  it('rejects (returns null for) a reason one character over MAX_VOID_REASON_LENGTH, rather than truncating it', () => {
    const tooLong = 'x'.repeat(MAX_VOID_REASON_LENGTH + 1)
    expect(normalizeVoidReason(tooLong)).toBeNull()
  })

  it('rejects a reason far over the limit the same way as one character over', () => {
    const wayTooLong = 'x'.repeat(MAX_VOID_REASON_LENGTH + 50)
    expect(normalizeVoidReason(wayTooLong)).toBeNull()
  })

  it('surrounding whitespace outside the limit does not by itself cause rejection', () => {
    const padded = `${'   '.repeat(2)}${'x'.repeat(MAX_VOID_REASON_LENGTH)}${'   '.repeat(2)}`
    expect(normalizeVoidReason(padded)).toBe('x'.repeat(MAX_VOID_REASON_LENGTH))
  })

  it('accepts a normal preset reason unchanged', () => {
    expect(normalizeVoidReason('Duplicate order')).toBe('Duplicate order')
  })
})
