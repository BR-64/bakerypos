import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  generateRecoveryCode,
  generateSalt,
  hashPin,
  isPinCryptoAvailable,
  isPinHash,
  isPinSalt,
  isValidPin,
  MAX_PIN_ATTEMPTS,
  normalizeRecoveryCode,
  PIN_CRYPTO_UNAVAILABLE_MESSAGE,
  PIN_LOCKOUT_MS,
  UNLOCK_DURATION_MS,
  verifyPin,
} from './pin'

// The vitest jsdom environment exposes Node's WebCrypto as `globalThis.crypto`,
// so `crypto.subtle.digest` is the real SHA-256 here — these tests exercise
// the production hashing path, not a stub. `isSecureContext` is undefined in
// jsdom, which is exactly why `isPinCryptoAvailable` feature-detects
// `crypto.subtle` itself instead of asking about the context.
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('isValidPin', () => {
  it('accepts 4 to 6 ASCII digits', () => {
    expect(isValidPin('1234')).toBe(true)
    expect(isValidPin('12345')).toBe(true)
    expect(isValidPin('123456')).toBe(true)
  })

  it('rejects anything else, without throwing', () => {
    expect(isValidPin('123')).toBe(false)
    expect(isValidPin('1234567')).toBe(false)
    expect(isValidPin('12a4')).toBe(false)
    expect(isValidPin('12 4')).toBe(false)
    expect(isValidPin('')).toBe(false)
    // Thai digits look like a PIN but the keypad can never produce them.
    expect(isValidPin('๑๒๓๔')).toBe(false)
    expect(isValidPin(1234)).toBe(false)
    expect(isValidPin(null)).toBe(false)
    expect(isValidPin(undefined)).toBe(false)
    expect(isValidPin({})).toBe(false)
  })
})

describe('hashPin', () => {
  it('never returns anything containing the PIN', async () => {
    const salt = generateSalt()
    const hash = await hashPin('4821', salt)

    expect(hash).not.toContain('4821')
    expect(isPinHash(hash)).toBe(true)
  })

  it('is deterministic for the same PIN and salt', async () => {
    const salt = generateSalt()

    expect(await hashPin('1234', salt)).toBe(await hashPin('1234', salt))
  })

  it('differs for the same PIN under a different salt', async () => {
    const a = await hashPin('1234', generateSalt())
    const b = await hashPin('1234', generateSalt())

    expect(a).not.toBe(b)
  })

  it('differs for a different PIN under the same salt', async () => {
    const salt = generateSalt()

    expect(await hashPin('1234', salt)).not.toBe(await hashPin('1235', salt))
  })

  it('rejects when Web Crypto is unavailable rather than inventing a hash', async () => {
    vi.stubGlobal('crypto', undefined)

    expect(isPinCryptoAvailable()).toBe(false)
    await expect(hashPin('1234', 'abcdef01')).rejects.toThrow(PIN_CRYPTO_UNAVAILABLE_MESSAGE)
  })
})

describe('verifyPin', () => {
  it('accepts the right PIN and rejects a wrong one', async () => {
    const salt = generateSalt()
    const hash = await hashPin('1234', salt)

    expect(await verifyPin('1234', salt, hash)).toBe(true)
    expect(await verifyPin('1235', salt, hash)).toBe(false)
    expect(await verifyPin('12345', salt, hash)).toBe(false)
  })

  it('fails closed for a missing or corrupt stored hash/salt, without throwing', async () => {
    const salt = generateSalt()
    const hash = await hashPin('1234', salt)

    expect(await verifyPin('1234', salt, null)).toBe(false)
    expect(await verifyPin('1234', null, hash)).toBe(false)
    expect(await verifyPin('1234', salt, 'not-a-hash')).toBe(false)
    expect(await verifyPin('1234', 'NOTHEX', hash)).toBe(false)
    expect(await verifyPin('1234', salt, 42)).toBe(false)
    expect(await verifyPin('', salt, hash)).toBe(false)
  })

  it('rejects (rather than resolving false) when Web Crypto is unavailable', async () => {
    const salt = generateSalt()
    const hash = await hashPin('1234', salt)
    vi.stubGlobal('crypto', undefined)

    // "Can't check" must not be reported as "wrong PIN" — the caller shows
    // an explanation instead of burning one of the five attempts.
    await expect(verifyPin('1234', salt, hash)).rejects.toThrow(PIN_CRYPTO_UNAVAILABLE_MESSAGE)
  })
})

describe('generateSalt', () => {
  it('returns fresh hex salts', () => {
    const a = generateSalt()
    const b = generateSalt()

    expect(isPinSalt(a)).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('generateRecoveryCode', () => {
  it('is three groups of four unambiguous characters', () => {
    const code = generateRecoveryCode()

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(code).not.toMatch(/[IO01]/)
  })

  it('does not repeat itself', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateRecoveryCode()))

    expect(codes.size).toBe(50)
  })

  it('round-trips through normalize, hash and verify', async () => {
    const code = generateRecoveryCode()
    const salt = generateSalt()
    const hash = await hashPin(normalizeRecoveryCode(code), salt)

    expect(await verifyPin(normalizeRecoveryCode(code.toLowerCase()), salt, hash)).toBe(true)
    expect(await verifyPin(normalizeRecoveryCode(generateRecoveryCode()), salt, hash)).toBe(false)
  })

  it('throws rather than using a weak random source when Web Crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)

    expect(() => generateRecoveryCode()).toThrow(PIN_CRYPTO_UNAVAILABLE_MESSAGE)
    expect(() => generateSalt()).toThrow(PIN_CRYPTO_UNAVAILABLE_MESSAGE)
  })
})

describe('normalizeRecoveryCode', () => {
  it('upper-cases and drops separators', () => {
    expect(normalizeRecoveryCode('abcd-efgh-jkmn')).toBe('ABCDEFGHJKMN')
    expect(normalizeRecoveryCode(' ABCD efgh\tJKMN ')).toBe('ABCDEFGHJKMN')
  })

  it('never throws on junk input', () => {
    expect(normalizeRecoveryCode(null)).toBe('')
    expect(normalizeRecoveryCode(1234)).toBe('')
    expect(normalizeRecoveryCode('!!!')).toBe('')
  })
})

describe('SPEC constants', () => {
  it('match docs/SPEC.md: five attempts, 60s lockout, 5-minute unlock', () => {
    expect(MAX_PIN_ATTEMPTS).toBe(5)
    expect(PIN_LOCKOUT_MS).toBe(60_000)
    expect(UNLOCK_DURATION_MS).toBe(300_000)
  })
})
