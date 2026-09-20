import { useCallback, useState } from 'react'

/**
 * Where "the owner has seen and dismissed the hint" is remembered.
 *
 * `localStorage`, not the settings row: this is a per-device note about a
 * banner, it needs to survive nothing more than a reload, and a failed
 * write must cost nothing. Dexie is for the shop's data.
 */
export const INSTALL_HINT_DISMISSED_KEY = 'bakery-pos:install-hint-dismissed'

/** Display modes that mean "already installed", not "a browser tab". */
const INSTALLED_DISPLAY_MODES = ['standalone', 'minimal-ui', 'fullscreen'] as const

/**
 * Whether the app is running as an installed PWA rather than in a tab.
 *
 * `display-mode` covers Android and desktop; `navigator.standalone` is iOS
 * Safari's own flag, which is the case that matters most here — the phone
 * at the counter. Anything unreadable (no `matchMedia`, a stub that
 * throws) counts as *not* installed, so the worst case is a dismissable
 * hint shown once too often rather than one that can never be shown.
 */
export function isInstalledDisplay(): boolean {
  try {
    const iosFlag: unknown = (navigator as { standalone?: unknown }).standalone
    if (iosFlag === true) return true
    if (typeof window.matchMedia !== 'function') return false
    return INSTALLED_DISPLAY_MODES.some(
      (mode) => window.matchMedia(`(display-mode: ${mode})`).matches === true,
    )
  } catch {
    return false
  }
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_HINT_DISMISSED_KEY) === '1'
  } catch {
    // Private mode, blocked storage: show the hint rather than crash.
    return false
  }
}

/** Whether the "Add to Home screen" hint should be shown at all. */
export function shouldOfferInstallHint(): boolean {
  return !isInstalledDisplay() && !wasDismissed()
}

export interface InstallHintState {
  /** True only in a browser tab, on a device that hasn't dismissed it. */
  visible: boolean
  /** Hide it now and remember that, so it doesn't come back next launch. */
  dismiss: () => void
}

/**
 * State for the first-run "Add to Home screen" hint.
 *
 * The decision is taken once, in the `useState` initializer: `matchMedia`
 * and `localStorage` are read at mount and nothing that happens later
 * changes the answer (a phone that gets installed mid-session reloads into
 * its own window), so there is no listener to keep and nothing to
 * re-check. Deciding here rather than in an effect also means an installed
 * app never renders the banner even for one frame.
 */
export function useInstallHint(): InstallHintState {
  const [visible, setVisible] = useState(shouldOfferInstallHint)

  const dismiss = useCallback(() => {
    setVisible(false)
    try {
      window.localStorage.setItem(INSTALL_HINT_DISMISSED_KEY, '1')
    } catch {
      // Couldn't remember it; the hint returns next launch, which is a
      // great deal better than a failed write taking the app down.
    }
  }, [])

  return { visible, dismiss }
}
