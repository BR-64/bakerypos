import { safeString } from '../domain/log'
import { coerceSettings, DEFAULT_SETTINGS, SETTINGS_ID, type Settings } from '../domain/settings'
import { db, type PosDatabase } from './db'

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
  try {
    const row = await database.settings.get(SETTINGS_ID)
    if (row === undefined) return DEFAULT_SETTINGS
    return coerceSettings(row)
  } catch (error) {
    // `safeString` (not `String(error)`) for the non-Error case: whatever
    // a rejected IndexedDB read hands back is untrusted, and building this
    // message must not be what finally throws.
    const message = error instanceof Error ? error.message : safeString(error)
    console.error(`getSettings: using defaults, the settings read failed — ${message}`)
    return DEFAULT_SETTINGS
  }
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
