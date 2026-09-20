import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PosDatabase } from '../db/db'
import { getSettings } from '../db/settings'
import type { Settings } from '../domain/settings'

/**
 * The shop settings, live: any `saveSettings` write (Admin, task 7b)
 * re-emits here and every screen holding `ScreenProps.settings` updates.
 *
 * Returns `null` while the first read is still in flight. `null` means
 * *not loaded yet* — never "use the defaults". A screen that needs a real
 * value (the PromptPay QR's recipient above all) must render a loading
 * state for `null` rather than substituting a guess; `getSettings` already
 * substitutes `DEFAULT_SETTINGS` for every case where there genuinely is
 * no usable stored value, so a `null` here is only ever "not yet".
 *
 * `getSettings` resolves even when the underlying read fails, which is
 * what makes this safe to call in `App.tsx`'s body above every
 * `ErrorBoundary`: `useLiveQuery` re-throws a rejected query during
 * render, and there would be no boundary above App to catch it.
 */
export function useSettings(database: PosDatabase = db): Settings | null {
  const settings = useLiveQuery(() => getSettings(database), [database])
  return settings ?? null
}
