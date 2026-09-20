import { describe, expect, it } from 'vitest'
import { PLACEHOLDER_PROMPTPAY_ID } from '../config'
import {
  coerceSettings,
  DEFAULT_SETTINGS,
  isValidSettings,
  SETTINGS_ID,
  type Settings,
} from './settings'

const realId = '0812345678'

const good: Settings = { id: SETTINGS_ID, shopName: 'Sunrise Bakery', promptPayId: realId }

describe('DEFAULT_SETTINGS', () => {
  it('is itself valid, and uses the placeholder PromptPay ID so the test-ID warning shows', () => {
    expect(isValidSettings(DEFAULT_SETTINGS)).toBe(true)
    expect(DEFAULT_SETTINGS.promptPayId).toBe(PLACEHOLDER_PROMPTPAY_ID)
    expect(DEFAULT_SETTINGS.shopName).toBe('Bakery')
    expect(DEFAULT_SETTINGS.id).toBe(SETTINGS_ID)
  })
})

describe('isValidSettings', () => {
  it('accepts a well-formed row', () => {
    expect(isValidSettings(good)).toBe(true)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a string', 'shop'],
    ['a number', 7],
    ['a bigint', 10n],
    ['an empty object', {}],
    ['a wrong id', { ...good, id: 'other' }],
    ['a missing shopName', { id: SETTINGS_ID, promptPayId: realId }],
    ['a whitespace-only shopName', { ...good, shopName: '   ' }],
    ['a non-string shopName', { ...good, shopName: 42 }],
    ['a non-string promptPayId', { ...good, promptPayId: 812345678 }],
    ['a malformed promptPayId', { ...good, promptPayId: '081-234-5678' }],
    ['an 11-digit promptPayId', { ...good, promptPayId: '08123456789' }],
  ])('rejects %s without throwing', (_label, value) => {
    expect(() => isValidSettings(value)).not.toThrow()
    expect(isValidSettings(value)).toBe(false)
  })

  it('accepts a 13-digit national ID', () => {
    expect(isValidSettings({ ...good, promptPayId: '1234567890123' })).toBe(true)
  })
})

describe('coerceSettings', () => {
  it('returns a valid row unchanged', () => {
    expect(coerceSettings(good)).toEqual(good)
  })

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', []],
    ['a bigint', 10n],
    ['a string', 'nonsense'],
    [
      'a circular object',
      (() => {
        const o: Record<string, unknown> = { shopName: 1 }
        o.self = o
        return o
      })(),
    ],
  ])('falls back to the defaults for %s, never throwing', (_label, value) => {
    expect(() => coerceSettings(value)).not.toThrow()
    expect(coerceSettings(value)).toEqual(DEFAULT_SETTINGS)
  })

  it('corrects a corrupt shopName without reverting a valid real promptPayId', () => {
    expect(coerceSettings({ id: SETTINGS_ID, shopName: '  ', promptPayId: realId })).toEqual({
      id: SETTINGS_ID,
      shopName: DEFAULT_SETTINGS.shopName,
      promptPayId: realId,
    })
  })

  it('corrects a corrupt promptPayId to the placeholder without losing a valid shopName', () => {
    expect(
      coerceSettings({ id: SETTINGS_ID, shopName: 'Sunrise Bakery', promptPayId: 'nope' }),
    ).toEqual({
      id: SETTINGS_ID,
      shopName: 'Sunrise Bakery',
      promptPayId: PLACEHOLDER_PROMPTPAY_ID,
    })
  })

  it('always writes the singleton id, whatever the input said', () => {
    expect(coerceSettings({ ...good, id: 'someone-elses-row' }).id).toBe(SETTINGS_ID)
  })

  it('drops unknown extra fields (the documented contract for adding fields)', () => {
    expect(coerceSettings({ ...good, pinHash: 'abc' })).toEqual(good)
  })

  it('always returns something isValidSettings accepts', () => {
    for (const value of [null, {}, good, { shopName: 'X' }, 'junk', 0]) {
      expect(isValidSettings(coerceSettings(value))).toBe(true)
    }
  })
})
