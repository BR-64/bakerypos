/**
 * The Admin PIN: hashing, verification and recovery codes.
 *
 * No React and no Dexie, so every rule here is unit-testable on its own.
 * The one non-pure dependency is the Web Crypto API (`crypto.subtle` for
 * SHA-256, `crypto.getRandomValues` for salts and recovery codes) — per
 * `docs/SPEC.md` the PIN is stored as a salted SHA-256 hash and **never**
 * in plain text, so this module is the only place a PIN is ever turned
 * into something storable.
 *
 * `crypto.subtle` exists only in a secure context (https, or localhost).
 * A phone that opened the app over plain http on the LAN therefore has no
 * `subtle`, and every function here that needs it throws
 * `PIN_CRYPTO_UNAVAILABLE_MESSAGE` rather than falling back to a home-made
 * hash, which would be worse than useless — it would look secure. The
 * caller (`PinPrompt`) catches that and shows the message with the prompt
 * still usable: Admin stays **locked**, which is the fail-closed direction.
 */

/** Shortest PIN the SPEC allows. */
export const MIN_PIN_LENGTH = 4
/** Longest PIN the SPEC allows. */
export const MAX_PIN_LENGTH = 6
/** Wrong attempts before the prompt locks (SPEC: five). */
export const MAX_PIN_ATTEMPTS = 5
/** How long the prompt stays locked after `MAX_PIN_ATTEMPTS` (SPEC: 60 seconds). */
export const PIN_LOCKOUT_MS = 60_000
/** How long a successful unlock lasts (SPEC: 5 minutes, or until the app closes). */
export const UNLOCK_DURATION_MS = 5 * 60_000

/**
 * A stored lockout deadline (`settings.lockedUntil`), if it is one worth
 * honouring at `now` — otherwise `null`.
 *
 * The lockout is persisted so that force-quitting the app is not a way
 * around it (`usePinLock`), which means the deadline in the settings row
 * is untrusted data like everything else read back from Dexie: it can be
 * a string, a `NaN`, a year-3000 timestamp written by a phone whose clock
 * was wrong, or simply a perfectly good deadline on a phone whose clock
 * has since been wound back.
 *
 * So anything that is not a positive safe integer is ignored, and — the
 * important one — so is any deadline **more than one lockout away**. The
 * keypad this guards is the only way into Admin, and the recovery code is
 * behind the same keypad, so an unbounded stored deadline could lock the
 * owner out of their own shop for years with no way back. Capping it at
 * `PIN_LOCKOUT_MS` makes the worst case 60 seconds.
 */
export function usableLockoutDeadline(lockedUntil: unknown, now: number): number | null {
  if (typeof lockedUntil !== 'number' || !Number.isSafeInteger(lockedUntil)) return null
  if (lockedUntil <= now) return null
  if (lockedUntil - now > PIN_LOCKOUT_MS) return null
  return lockedUntil
}

/** Shown when the device has no Web Crypto (an insecure context, e.g. plain http). */
export const PIN_CRYPTO_UNAVAILABLE_MESSAGE =
  'This device can’t secure a PIN — open the app over https. Admin stays locked.'

/**
 * Alphabet for recovery codes: upper-case letters without `I`/`O` and
 * digits without `0`/`1`, so a code copied off the screen onto paper and
 * typed back a week later can't be misread as a different valid character.
 * Exactly 32 characters, which divides 256 evenly, so `byte % 32` is
 * unbiased and needs no rejection sampling.
 */
const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** Characters per dash-separated group in a recovery code. */
const RECOVERY_GROUP_SIZE = 4
/** Groups per code: 12 characters × 5 bits ≈ 60 bits of entropy. */
const RECOVERY_GROUPS = 3
/** Bytes of salt per PIN — far more than a 6-digit PIN needs, and cheap. */
const SALT_BYTES = 16

/** Whether the Web Crypto API this module needs is available. */
export function isPinCryptoAvailable(): boolean {
  const c: Crypto | undefined = globalThis.crypto
  return (
    typeof c === 'object' &&
    c !== null &&
    typeof c.getRandomValues === 'function' &&
    typeof c.subtle === 'object' &&
    c.subtle !== null &&
    typeof c.subtle.digest === 'function'
  )
}

function requireCrypto(): Crypto {
  if (!isPinCryptoAvailable()) throw new Error(PIN_CRYPTO_UNAVAILABLE_MESSAGE)
  return globalThis.crypto
}

/**
 * A PIN is 4–6 ASCII digits (`MIN_PIN_LENGTH`–`MAX_PIN_LENGTH`). The
 * character class is ASCII-only on purpose: something that merely looks
 * like digits (Thai numerals, full-width digits) must not be accepted as a
 * PIN that the numeric keypad can never reproduce.
 */
export function isValidPin(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9]{4,6}$/.test(value)
}

/** Whether `value` looks like one of our stored SHA-256 hex digests. */
export function isPinHash(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

/** Whether `value` looks like one of our stored salts (lower-case hex). */
export function isPinSalt(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8,256}$/.test(value)
}

function toHex(bytes: Uint8Array): string {
  let hex = ''
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0')
  return hex
}

/** A fresh random salt, hex-encoded. One per PIN, regenerated on every reset. */
export function generateSalt(): string {
  const bytes = new Uint8Array(SALT_BYTES)
  requireCrypto().getRandomValues(bytes)
  return toHex(bytes)
}

/**
 * A one-time recovery code, e.g. `"ABCD-EFGH-JKMN"`.
 *
 * It is shown **once**, when the PIN is set, and only its hash is stored:
 * there is no cloud to recover a forgotten PIN from (SPEC), so this is the
 * only way back in, and a copy kept in the database would just be a second
 * PIN in plain text.
 */
export function generateRecoveryCode(): string {
  const length = RECOVERY_GROUP_SIZE * RECOVERY_GROUPS
  const bytes = new Uint8Array(length)
  requireCrypto().getRandomValues(bytes)
  let code = ''
  for (let i = 0; i < length; i += 1) {
    if (i > 0 && i % RECOVERY_GROUP_SIZE === 0) code += '-'
    code += RECOVERY_ALPHABET[bytes[i] % RECOVERY_ALPHABET.length]
  }
  return code
}

/**
 * Canonical form of a recovery code as typed back in: upper-cased, with
 * dashes, spaces and anything else outside the alphabet dropped. Hashing
 * and comparison always run on this form, so `"abcd efgh jkmn"` and
 * `"ABCD-EFGH-JKMN"` are the same code.
 */
export function normalizeRecoveryCode(input: unknown): string {
  if (typeof input !== 'string') return ''
  let normalized = ''
  for (const char of input.toUpperCase()) {
    if (RECOVERY_ALPHABET.includes(char)) normalized += char
  }
  return normalized
}

/**
 * Salted SHA-256 of a secret (a PIN, or a normalized recovery code),
 * hex-encoded.
 *
 * The salt is mixed in with a fixed, versioned prefix rather than by plain
 * concatenation, so a digest can never double as something else's digest
 * and a future scheme change can't silently keep accepting old ones. The
 * *format* of `secret` is the caller's business — `isValidPin` guards PIN
 * entry — because the same hashing covers recovery codes.
 */
export async function hashPin(secret: string, salt: string): Promise<string> {
  const crypto = requireCrypto()
  const bytes = new TextEncoder().encode(`bakery-pos:pin:v1:${salt}:${secret}`)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toHex(new Uint8Array(digest))
}

/**
 * Whether `secret` hashes to `hash` under `salt`.
 *
 * Resolves `false` — never throws — for a missing or malformed stored
 * hash/salt (the settings row is untrusted data, CLAUDE.md), which fails
 * closed: an unusable stored hash unlocks nothing. It still *rejects* when
 * Web Crypto is unavailable, because "can't check" is not "wrong PIN" and
 * the caller must say so rather than burning an attempt.
 *
 * The comparison is a plain string compare. Timing is irrelevant here: the
 * attacker is a person holding the phone, tapping a keypad that locks for
 * 60 seconds after five wrong guesses.
 */
export async function verifyPin(secret: string, salt: unknown, hash: unknown): Promise<boolean> {
  if (!isPinSalt(salt) || !isPinHash(hash)) return false
  if (typeof secret !== 'string' || secret.length === 0) return false
  return (await hashPin(secret, salt)) === hash
}
