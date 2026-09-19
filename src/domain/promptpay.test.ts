import { describe, expect, it } from 'vitest'
import { formatPromptPayAmount, isValidPromptPayId, promptPayPayload } from './promptpay'

/**
 * CRC16/XMODEM (poly 0x1021, init 0xFFFF, no reflect, no xorout), written
 * independently of `promptpay-qr`'s own `crc` dependency, so this test would
 * catch a broken checksum even if that dependency were.
 */
function crc16xmodem(input: string): number {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

const PHONE_ID = '0000000000'
const TAX_ID = '1234567890123'

describe('isValidPromptPayId', () => {
  it('accepts a 10-digit phone number starting with 0', () => {
    expect(isValidPromptPayId('0812345678')).toBe(true)
    expect(isValidPromptPayId(PHONE_ID)).toBe(true)
  })

  it('accepts a 13-digit ID', () => {
    expect(isValidPromptPayId(TAX_ID)).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isValidPromptPayId('1812345678')).toBe(false) // 10 digits, not starting with 0
    expect(isValidPromptPayId('081234567')).toBe(false) // 9 digits
    expect(isValidPromptPayId('123456789012')).toBe(false) // 12 digits
    expect(isValidPromptPayId('081-234-5678')).toBe(false) // punctuation
    expect(isValidPromptPayId('081234567a')).toBe(false) // letters
    expect(isValidPromptPayId('')).toBe(false)
  })
})

describe('formatPromptPayAmount', () => {
  it('formats satang as baht with two decimals using integer maths', () => {
    expect(formatPromptPayAmount(11000)).toBe('110.00')
    expect(formatPromptPayAmount(4550)).toBe('45.50')
    expect(formatPromptPayAmount(5)).toBe('0.05')
    expect(formatPromptPayAmount(100)).toBe('1.00')
  })

  it('throws for a non-integer amount', () => {
    expect(() => formatPromptPayAmount(45.5)).toThrow()
    expect(() => formatPromptPayAmount(Number.NaN)).toThrow()
  })
})

describe('promptPayPayload', () => {
  it('embeds the amount field with two decimals, matching the library exactly', () => {
    expect(promptPayPayload(PHONE_ID, 11000)).toContain('5406110.00')
    expect(promptPayPayload(PHONE_ID, 4550)).toContain('540545.50')
    expect(promptPayPayload(PHONE_ID, 5)).toContain('54040.05')
    expect(promptPayPayload(PHONE_ID, 100)).toContain('54041.00')
  })

  it('is dynamic — POI method 12 — because an amount is always present', () => {
    expect(promptPayPayload(PHONE_ID, 4550)).toContain('010212')
  })

  it('ends with the field-63 CRC16/XMODEM of everything before it, checked against an independent implementation', () => {
    const payload = promptPayPayload(PHONE_ID, 4550)
    const withoutCrc = payload.slice(0, -4)
    const expected = crc16xmodem(withoutCrc).toString(16).toUpperCase().padStart(4, '0')
    expect(payload.slice(-4)).toBe(expected)
    expect(withoutCrc.endsWith('6304')).toBe(true)
  })

  it('matches a golden payload for a known ID and amount', () => {
    expect(promptPayPayload(PHONE_ID, 4550)).toBe(
      '00020101021229370016A000000677010111011300660000000005802TH5303764540545.5063046F26',
    )
  })

  it('throws for a total that is zero, negative or fractional', () => {
    expect(() => promptPayPayload(PHONE_ID, 0)).toThrow()
    expect(() => promptPayPayload(PHONE_ID, -100)).toThrow()
    expect(() => promptPayPayload(PHONE_ID, 45.5)).toThrow()
  })

  it('throws for an amount too long to fit the payload field', () => {
    // 123456789012.00 is 15 characters, over the 13-character field limit,
    // while 12345678901200 is still a safe integer.
    expect(() => promptPayPayload(PHONE_ID, 12345678901200)).toThrow()
  })

  it('throws for a bad PromptPay ID', () => {
    expect(() => promptPayPayload('123', 4550)).toThrow('Invalid PromptPay ID')
    expect(() => promptPayPayload('not-a-number', 4550)).toThrow('Invalid PromptPay ID')
  })
})
