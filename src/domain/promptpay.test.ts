import { describe, expect, it } from 'vitest'
import {
  canEncodePromptPayAmount,
  formatPromptPayAmount,
  isValidPromptPayId,
  PLACEHOLDER_PROMPTPAY_ID,
  promptPayPayload,
} from './promptpay'

/**
 * CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflect, no xorout) —
 * what EMV/BOT's PromptPay QR spec actually uses for field 63, written
 * independently of `promptpay-qr`'s own `crc` dependency so this test would
 * catch a broken checksum even if that dependency were. Note this is *not*
 * CRC-16/XMODEM despite `crc`'s function being named `crc16xmodem`: XMODEM
 * uses the same polynomial but an init of 0, not 0xFFFF — `promptpay-qr`
 * gets CCITT-FALSE behaviour out of that function only because it passes
 * 0xFFFF in explicitly as the running CRC's initial value.
 */
function crc16CcittFalse(input: string): number {
  let crc = 0xffff
  for (let i = 0; i < input.length; i++) {
    crc ^= input.charCodeAt(i) << 8
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff
    }
  }
  return crc
}

/**
 * Parses top-level EMV QR TLV fields (2-digit ID, 2-digit length, value)
 * into a Map, in order — independent of (and simpler than) `promptpay.ts`'s
 * own private `extractField`, so these tests aren't just re-checking that
 * function against itself. Also used to parse the nested TLV value of field
 * 29 (merchant account info).
 */
function parseTlv(payload: string): Map<string, string> {
  const fields = new Map<string, string>()
  let pos = 0
  while (pos + 4 <= payload.length) {
    const id = payload.slice(pos, pos + 2)
    const length = Number(payload.slice(pos + 2, pos + 4))
    const value = payload.slice(pos + 4, pos + 4 + length)
    fields.set(id, value)
    pos += 4 + length
  }
  return fields
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

  // Fail-closed on purpose: anything that isn't exactly ASCII digits is
  // rejected, even if a human would read it as "the same number" — see the
  // doc comment on isValidPromptPayId.
  it('rejects spaces, a leading +, and non-ASCII (Thai) digits', () => {
    expect(isValidPromptPayId('081-234-5678')).toBe(false)
    expect(isValidPromptPayId('081 234 5678')).toBe(false)
    expect(isValidPromptPayId('+66812345678')).toBe(false)
    expect(isValidPromptPayId('๐๘๑๒๓๔๕๖๗๘')).toBe(false)
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

describe('canEncodePromptPayAmount', () => {
  it('is true right up to the 13-character amount-field boundary, false just past it', () => {
    expect(canEncodePromptPayAmount(999999999999)).toBe(true) // "9999999999.99" (13 chars)
    expect(canEncodePromptPayAmount(1000000000000)).toBe(false) // "10000000000.00" (14 chars)
  })

  it('is false (never throws) for an amount that cannot even be formatted, including a fractional total', () => {
    expect(canEncodePromptPayAmount(Number.NaN)).toBe(false)
    expect(canEncodePromptPayAmount(45.5)).toBe(false)
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

  it('ends with the field-63 CRC-16/CCITT-FALSE of everything before it, checked against an independent implementation', () => {
    const payload = promptPayPayload(PHONE_ID, 4550)
    const withoutCrc = payload.slice(0, -4)
    const expected = crc16CcittFalse(withoutCrc).toString(16).toUpperCase().padStart(4, '0')
    expect(payload.slice(-4)).toBe(expected)
    expect(withoutCrc.endsWith('6304')).toBe(true)
  })

  it('encodes a 10-digit phone number per EMVCo/BOT: AID, then sub-field 01 zero-padded to 13 digits with the leading 0 replaced by 66', () => {
    const payload = promptPayPayload('0812345678', 4550)
    const merchantAccount = parseTlv(parseTlv(payload).get('29') ?? '')
    expect(merchantAccount.get('00')).toBe('A000000677010111')
    expect(merchantAccount.get('01')).toBe('0066812345678')
    expect(merchantAccount.has('02')).toBe(false)
  })

  it('encodes a 13-digit ID per EMVCo/BOT as sub-field 02, unchanged', () => {
    const payload = promptPayPayload(TAX_ID, 4550)
    const merchantAccount = parseTlv(parseTlv(payload).get('29') ?? '')
    expect(merchantAccount.get('00')).toBe('A000000677010111')
    expect(merchantAccount.get('02')).toBe(TAX_ID)
    expect(merchantAccount.has('01')).toBe(false)
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

  it('is right at the 13-character amount-field boundary: fits at 999999999999, throws at 1000000000000', () => {
    expect(() => promptPayPayload(PHONE_ID, 999999999999)).not.toThrow()
    expect(() => promptPayPayload(PHONE_ID, 1000000000000)).toThrow()
  })

  it('throws for a bad PromptPay ID', () => {
    expect(() => promptPayPayload('123', 4550)).toThrow('Invalid PromptPay ID')
    expect(() => promptPayPayload('not-a-number', 4550)).toThrow('Invalid PromptPay ID')
  })
})

describe('PLACEHOLDER_PROMPTPAY_ID', () => {
  it('is well-formed, so it still builds a scannable (if useless) QR', () => {
    expect(isValidPromptPayId(PLACEHOLDER_PROMPTPAY_ID)).toBe(true)
    expect(() => promptPayPayload(PLACEHOLDER_PROMPTPAY_ID, 5500)).not.toThrow()
  })
})
