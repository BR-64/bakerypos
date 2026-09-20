import { useLiveQuery } from 'dexie-react-hooks'
import { db, type PosDatabase } from '../db/db'
import { readSettings } from '../db/settings'
import type { Settings } from '../domain/settings'

export interface SettingsState {
  /**
   * The settings, or `null` while the first read is still in flight.
   *
   * `null` means *not loaded yet* — never "use the defaults". A screen
   * that needs a real value (the PromptPay QR's recipient above all) must
   * render a loading state for `null` rather than substituting a guess;
   * `getSettings` already substitutes `DEFAULT_SETTINGS` for every case
   * where there genuinely is no usable stored value, so a `null` here is
   * only ever "not yet".
   */
  settings: Settings | null
  /**
   * True when the read **failed**, in which case `settings` holds defaults
   * that were never stored. Distinct from "no row yet", which is normal
   * until the first Admin save and is not a failure. See
   * `ScreenProps.settingsFailed`.
   */
  failed: boolean
}

/**
 * The shop settings, live: any `saveSettings`/`updateSettings` write
 * (Admin, the PIN flows) re-emits here and every screen holding
 * `ScreenProps.settings` updates.
 *
 * `readSettings` resolves even when the underlying read fails, which is
 * what makes this safe to call in `App.tsx`'s body above every
 * `ErrorBoundary`: `useLiveQuery` re-throws a rejected query during
 * render, and there would be no boundary above App to catch it.
 */
export function useSettings(database: PosDatabase = db): SettingsState {
  const state = useLiveQuery(() => readSettings(database), [database])
  return state === undefined ? { settings: null, failed: false } : state
}
