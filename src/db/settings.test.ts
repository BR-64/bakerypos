import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_ID, type Settings } from '../domain/settings'
import { PosDatabase } from './db'
import { getSettings, readSettings, saveSettings, updateSettings } from './settings'

let database: PosDatabase
let name: string

beforeEach(async () => {
  name = `test-${Math.random()}`
  database = new PosDatabase(name)
  await database.open()
})

afterEach(() => {
  vi.restoreAllMocks()
})

const real: Settings = {
  ...DEFAULT_SETTINGS,
  shopName: 'Sunrise Bakery',
  promptPayId: '0812345678',
}

/** Stand-ins for the hash/salt shapes `src/domain/pin.ts` accepts. */
const pinHash = 'a'.repeat(64)
const recoveryHash = 'b'.repeat(64)
const pinSalt = 'c'.repeat(32)

describe('getSettings', () => {
  it('returns the defaults when there is no row', async () => {
    await expect(getSettings(database)).resolves.toEqual(DEFAULT_SETTINGS)
  })

  it('returns the stored row when it is well-formed', async () => {
    await saveSettings(real, database)
    await expect(getSettings(database)).resolves.toEqual(real)
  })

  it('repairs a junk row field by field instead of discarding the good fields', async () => {
    // Written straight to the table, bypassing saveSettings' coercion, the
    // way a hand-edited or half-corrupted record would arrive.
    await database.settings.put({
      id: SETTINGS_ID,
      shopName: 42,
      promptPayId: '0812345678',
    } as unknown as Settings)

    await expect(getSettings(database)).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      shopName: DEFAULT_SETTINGS.shopName,
      promptPayId: '0812345678',
    })
  })

  it('returns the defaults for a wholly junk row', async () => {
    await database.settings.put({ id: SETTINGS_ID } as unknown as Settings)
    await expect(getSettings(database)).resolves.toEqual(DEFAULT_SETTINGS)
  })

  it('never rejects: a failing read logs and resolves with the defaults', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.settings, 'get').mockRejectedValue(new Error('IndexedDB is gone'))

    await expect(getSettings(database)).resolves.toEqual(DEFAULT_SETTINGS)
    expect(consoleError).toHaveBeenCalledTimes(1)
    expect(consoleError.mock.calls[0][0]).toContain('IndexedDB is gone')
  })
})

describe('saveSettings', () => {
  it('creates the row on first save and resolves with what was stored', async () => {
    const stored = await saveSettings(real, database)

    expect(stored).toEqual(real)
    expect(await database.settings.count()).toBe(1)
    expect(await database.settings.get(SETTINGS_ID)).toEqual(real)
  })

  it('upserts: a second save replaces the row rather than adding another', async () => {
    await saveSettings(real, database)
    await saveSettings({ ...real, shopName: 'Sunrise Bakery II' }, database)

    expect(await database.settings.count()).toBe(1)
    await expect(getSettings(database)).resolves.toEqual({ ...real, shopName: 'Sunrise Bakery II' })
  })

  it('coerces before writing, so a bad field never reaches the table', async () => {
    await saveSettings({ ...real, promptPayId: 'not-an-id' }, database)

    expect(await database.settings.get(SETTINGS_ID)).toEqual({
      ...real,
      promptPayId: DEFAULT_SETTINGS.promptPayId,
    })
  })

  it('always writes the singleton key, even if the caller passed another id', async () => {
    await saveSettings({ ...real, id: 'elsewhere' }, database)

    expect(await database.settings.count()).toBe(1)
    expect(await database.settings.get(SETTINGS_ID)).toEqual(real)
  })

  it('rejects (rather than swallowing) a failed write, so Admin can report it', async () => {
    vi.spyOn(database.settings, 'put').mockRejectedValue(new Error('disk full'))
    await expect(saveSettings(real, database)).rejects.toThrow('disk full')
  })

  it('survives a close and reopen of the same database', async () => {
    await saveSettings(real, database)
    database.close()

    const reopened = new PosDatabase(name)
    await reopened.open()
    await expect(getSettings(reopened)).resolves.toEqual(real)
    reopened.close()
  })

  it('stores the PIN fields, so the lock survives a reopen', async () => {
    await saveSettings({ ...real, pinHash, pinSalt, recoveryHash }, database)
    database.close()

    const reopened = new PosDatabase(name)
    await reopened.open()
    await expect(getSettings(reopened)).resolves.toEqual({
      ...real,
      pinHash,
      pinSalt,
      recoveryHash,
    })
    reopened.close()
  })
})

describe('readSettings', () => {
  it('reports failed: false for a missing row — "no row yet" is not a failure', async () => {
    await expect(readSettings(database)).resolves.toEqual({
      settings: DEFAULT_SETTINGS,
      failed: false,
    })
  })

  it('reports failed: true when the read rejects, with usable defaults alongside', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.spyOn(database.settings, 'get').mockRejectedValue(new Error('IndexedDB is gone'))

    // PromptPay shows "isn't set up — use Cash" for this, never a QR for
    // the placeholder account; Admin refuses to overwrite what it can't read.
    await expect(readSettings(database)).resolves.toEqual({
      settings: DEFAULT_SETTINGS,
      failed: true,
    })
  })

  it('never hands out the shared DEFAULT_SETTINGS arrays', async () => {
    const { settings } = await readSettings(database)

    expect(settings).not.toBe(DEFAULT_SETTINGS)
    expect(settings.categoryOrder).not.toBe(DEFAULT_SETTINGS.categoryOrder)
  })
})

describe('updateSettings', () => {
  it('changes one field and leaves the rest of the row alone', async () => {
    await saveSettings({ ...real, pinHash, pinSalt, recoveryHash }, database)

    const stored = await updateSettings({ shopName: 'Sunrise Bakery II' }, database)

    // The PIN above all: a "save the shop name" that blanked the hash would
    // unlock Admin for anyone holding the phone.
    expect(stored).toEqual({
      ...real,
      shopName: 'Sunrise Bakery II',
      pinHash,
      pinSalt,
      recoveryHash,
    })
    expect(await database.settings.count()).toBe(1)
  })

  it('creates the row on the first save when none exists yet', async () => {
    const stored = await updateSettings({ promptPayId: '0812345678' }, database)

    expect(stored).toEqual({ ...DEFAULT_SETTINGS, promptPayId: '0812345678' })
  })

  it('stores a PIN without disturbing the shop fields', async () => {
    await saveSettings(real, database)

    await updateSettings({ pinHash, pinSalt, recoveryHash }, database)

    await expect(getSettings(database)).resolves.toEqual({
      ...real,
      pinHash,
      pinSalt,
      recoveryHash,
    })
  })

  it('refuses to write when the current row could not be read', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const put = vi.spyOn(database.settings, 'put')
    vi.spyOn(database.settings, 'get').mockRejectedValue(new Error('IndexedDB is gone'))

    // Merging into defaults and writing that would replace a real shop's
    // settings — PIN included — on the strength of a failed read.
    await expect(updateSettings({ shopName: 'Nope' }, database)).rejects.toThrow(
      'nothing was changed',
    )
    expect(put).not.toHaveBeenCalled()
  })

  it('rejects a failed write so Admin can show it', async () => {
    vi.spyOn(database.settings, 'put').mockRejectedValue(new Error('disk full'))

    await expect(updateSettings({ shopName: 'Nope' }, database)).rejects.toThrow('disk full')
  })
})
