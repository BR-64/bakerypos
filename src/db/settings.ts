import { safeString } from '../domain/log'
import { coerceSettings, SETTINGS_ID, type Settings } from '../domain/settings'
import { db, type PosDatabase } from './db'

/** What `readSettings` resolves with: usable settings, plus whether they're real. */
export interface SettingsRead {
  /** Always usable, whatever happened — see `getSettings`. */
  settings: Settings
  /**
   * True when the read itself **failed**, so `settings` holds defaults that
   * were never stored anywhere.
   *
   * Callers that only display a value can ignore this. Two callers must
   * not: the PromptPay screen (which would otherwise show a QR for the
   * placeholder account as though it were the shop's — task 7b changed it
   * to say "PromptPay isn't set up — use Cash" instead) and Admin (whose
   * Save would overwrite a real stored row, PIN included, with defaults).
   * `updateSettings` refuses to write at all in this state.
   *
   * It is deliberately *not* the same as "no row yet": that case is normal
   * until the first Admin save, and the placeholder QR plus its test-ID
   * warning is the right thing to show for it.
   */
  failed: boolean
}

/**
 * Read the settings row, saying whether the read worked.
 *
 * `getSettings` is this with the flag dropped; everything that reasons
 * about *trusting* the values (Admin, the PromptPay QR's recipient, the
 * PIN lock) uses this instead.
 */
export async function readSettings(database: PosDatabase = db): Promise<SettingsRead> {
  try {
    const row = await database.settings.get(SETTINGS_ID)
    // `coerceSettings` handles the missing row (`undefined`) too, and
    // always builds a fresh object — never the shared `DEFAULT_SETTINGS`,
    // whose `categoryOrder` array Admin's reorder buttons would otherwise
    // mutate for every later fallback on the page.
    return { settings: coerceSettings(row), failed: false }
  } catch (error) {
    // `safeString` (not `String(error)`) for the non-Error case: whatever
    // a rejected IndexedDB read hands back is untrusted, and building this
    // message must not be what finally throws.
    const message = error instanceof Error ? error.message : safeString(error)
    console.error(`readSettings: using defaults, the settings read failed — ${message}`)
    return { settings: coerceSettings(undefined), failed: true }
  }
}

/**
 * Read the shop settings, always resolving to something usable.
 *
 * This is the one db reader that swallows its own errors rather than
 * letting the caller handle them. `useSettings` is called in `App.tsx`'s
 * body — *above* every `ErrorBoundary` — so a rejection re-thrown through
 * `useLiveQuery` would take down the Sell screen, the cart bar and the
 * bottom nav together, with nothing left to tap. Settings are never on the
 * critical path of storing a sale, so falling back is strictly better than
 * crashing.
 *
 * Three ways to end up with `DEFAULT_SETTINGS`: no row yet (the normal
 * state until the first Admin save — `src/db/seed.ts` deliberately seeds
 * none), a corrupt row (`coerceSettings` repairs what it can, field by
 * field), or a failed read (logged, then defaults).
 */
export async function getSettings(database: PosDatabase = db): Promise<Settings> {
  return (await readSettings(database)).settings
}

/**
 * Upsert the settings row and resolve with exactly what was stored.
 *
 * Unlike `getSettings` this does *not* swallow a failure: the Admin screen
 * (task 7b) has to tell the owner their change wasn't saved rather than
 * quietly pretending it was.
 *
 * The input runs through `coerceSettings` first, so the stored row is
 * always well-formed and always carries `SETTINGS_ID` — see that
 * function's contract note about fields added to `Settings` later.
 */
export async function saveSettings(
  settings: Settings,
  database: PosDatabase = db,
): Promise<Settings> {
  const stored = coerceSettings(settings)
  await database.settings.put(stored)
  return stored
}

/**
 * Change some settings fields, leaving the rest as stored.
 *
 * The row is a singleton written with one `put`, so Admin's "save the shop
 * name" must not be allowed to blank the PromptPay ID — or, far worse, the
 * PIN hash — just because the form only knew about one field. Every writer
 * in the app (the Admin forms, the set-PIN and recovery flows) goes through
 * here rather than calling `saveSettings` with a hand-built row.
 *
 * Refuses to write at all when the current row couldn't be read: merging a
 * patch into `DEFAULT_SETTINGS` and storing that would silently replace a
 * real shop's settings, and un-set their PIN, on the strength of a failed
 * read. The caller shows the rejection and keeps the form usable.
 *
 * The read-modify-write runs inside one `rw` transaction, because it is
 * otherwise a lost-update race between two controls with independent
 * in-flight flags: the owner corrects the PromptPay ID, taps "Save shop
 * settings", then taps "Move Jar up" before the first resolves — both
 * reads see the old row, the reorder's `put` lands last, and the corrected
 * PromptPay ID is written back to the old account. Serialising them means
 * the second read sees the first write. Everything inside is Dexie-only,
 * so it nests cleanly inside any caller's transaction too.
 */
export async function updateSettings(
  patch: Partial<Omit<Settings, 'id'>>,
  database: PosDatabase = db,
): Promise<Settings> {
  return database.transaction('rw', database.settings, async () => {
    const current = await readSettings(database)
    if (current.failed) {
      throw new Error("Couldn't read the current settings, so nothing was changed.")
    }
    return saveSettings({ ...current.settings, ...patch }, database)
  })
}
