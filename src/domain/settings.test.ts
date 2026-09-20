import { describe, expect, it } from 'vitest'
import { CATEGORY_ORDER } from './categories'
import { PLACEHOLDER_PROMPTPAY_ID } from './promptpay'
import {
  coerceSettings,
  DEFAULT_SETTINGS,
  isValidSettings,
  SETTINGS_ID,
  type Settings,
} from './settings'

const realId = '0812345678'

/** A stand-in for a real stored hash/salt — the shapes `pin.ts` accepts. */
const hash = 'a'.repeat(64)
const otherHash = 'b'.repeat(64)
const salt = 'c'.repeat(32)

const good: Settings = {
  id: SETTINGS_ID,
  shopName: 'Sunrise Bakery',
  promptPayId: realId,
  categoryOrder: [...CATEGORY_ORDER],
  pinHash: null,
  pinSalt: null,
  recoveryHash: null,
  lockedUntil: null,
}

const withPin: Settings = { ...good, pinHash: hash, pinSalt: salt, recoveryHash: otherHash }

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

  it('accepts a row with a stored PIN, and rejects half-stored PIN fields', () => {
    expect(isValidSettings(withPin)).toBe(true)
    expect(isValidSettings({ ...withPin, pinSalt: null })).toBe(false)
    expect(isValidSettings({ ...withPin, pinHash: 'not-a-hash' })).toBe(false)
    expect(isValidSettings({ ...good, recoveryHash: hash })).toBe(false)
  })

  it('rejects a category order that is not a full permutation', () => {
    expect(isValidSettings({ ...good, categoryOrder: ['cake'] })).toBe(false)
    expect(isValidSettings({ ...good, categoryOrder: undefined })).toBe(false)
    expect(isValidSettings({ ...good, categoryOrder: [...CATEGORY_ORDER, 'cake'] })).toBe(false)
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
      ...good,
      shopName: DEFAULT_SETTINGS.shopName,
      promptPayId: realId,
    })
  })

  it('corrects a corrupt promptPayId to the placeholder without losing a valid shopName', () => {
    expect(
      coerceSettings({ id: SETTINGS_ID, shopName: 'Sunrise Bakery', promptPayId: 'nope' }),
    ).toEqual({
      ...good,
      shopName: 'Sunrise Bakery',
      promptPayId: PLACEHOLDER_PROMPTPAY_ID,
    })
  })

  it('keeps a stored PIN through a corrupt shopName (the lock is not a display field)', () => {
    expect(coerceSettings({ ...withPin, shopName: 42 })).toEqual({
      ...withPin,
      shopName: DEFAULT_SETTINGS.shopName,
    })
  })

  it('carries the PIN fields across a save — the coerceSettings contract from 7a', () => {
    // `saveSettings` writes `coerceSettings(input)`, so a field this
    // function forgets is silently dropped on every save. These three are
    // the whole lock: dropping them would unlock Admin for good.
    const stored = coerceSettings(withPin)

    expect(stored.pinHash).toBe(hash)
    expect(stored.pinSalt).toBe(salt)
    expect(stored.recoveryHash).toBe(otherHash)
    expect(coerceSettings({ ...good, categoryOrder: ['drink', 'cake'] }).categoryOrder).toEqual([
      'drink',
      'cake',
      'bread',
      'pastry',
      'other',
    ])
  })

  it('drops a hash without its salt, both ways, back to no-PIN-set', () => {
    // A hash with no salt can never match anything: keeping it would leave
    // Admin locked forever with no way back in.
    expect(coerceSettings({ ...withPin, pinSalt: 'not hex' })).toMatchObject({
      pinHash: null,
      pinSalt: null,
      recoveryHash: null,
    })
    expect(coerceSettings({ ...withPin, pinHash: undefined })).toMatchObject({
      pinHash: null,
      pinSalt: null,
      recoveryHash: null,
    })
  })

  it('keeps the PIN when only the recovery hash is corrupt', () => {
    expect(coerceSettings({ ...withPin, recoveryHash: 'nope' })).toEqual({
      ...withPin,
      recoveryHash: null,
    })
  })

  it('carries lockedUntil across a save, so a force-quit cannot shrug off a lockout', () => {
    // Same contract as the PIN fields: `saveSettings` writes
    // `coerceSettings(input)`, so a field forgotten here is dropped on
    // every write — and a lockout that doesn't survive being written is
    // no lockout at all.
    const deadline = 1_700_000_060_000

    expect(coerceSettings({ ...good, lockedUntil: deadline }).lockedUntil).toBe(deadline)
  })

  it.each([
    ['a string', '1700000060000'],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a non-integer', 1.5],
    ['a number past the safe range', 1e300],
    ['zero', 0],
    ['a negative timestamp', -1],
    ['a bigint', 10n],
    ['an object', {}],
  ])('drops a lockedUntil that is %s', (_label, value) => {
    expect(coerceSettings({ ...good, lockedUntil: value }).lockedUntil).toBeNull()
    expect(isValidSettings({ ...good, lockedUntil: value })).toBe(false)
  })

  it('repairs a category order that is missing, junk, duplicated or unknown', () => {
    expect(coerceSettings({ ...good, categoryOrder: 'cake' }).categoryOrder).toEqual([
      ...CATEGORY_ORDER,
    ])
    expect(
      coerceSettings({ ...good, categoryOrder: ['cake', 'cake', 'nope', null] }).categoryOrder,
    ).toEqual(['cake', 'bread', 'pastry', 'drink', 'other'])
  })

  it('never hands back the shared CATEGORY_ORDER array, so Admin can reorder safely', () => {
    expect(coerceSettings({}).categoryOrder).not.toBe(CATEGORY_ORDER)
    expect(coerceSettings({}).categoryOrder).not.toBe(DEFAULT_SETTINGS.categoryOrder)
  })

  it('always writes the singleton id, whatever the input said', () => {
    expect(coerceSettings({ ...good, id: 'someone-elses-row' }).id).toBe(SETTINGS_ID)
  })

  it('drops unknown extra fields (the documented contract for adding fields)', () => {
    expect(coerceSettings({ ...good, leftoverFromSomeOldVersion: 'abc' })).toEqual(good)
  })

  it('always returns something isValidSettings accepts', () => {
    for (const value of [null, {}, good, { shopName: 'X' }, 'junk', 0]) {
      expect(isValidSettings(coerceSettings(value))).toBe(true)
    }
  })
})
