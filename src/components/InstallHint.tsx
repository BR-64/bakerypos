import { useInstallHint } from '../hooks/useInstallHint'

/**
 * First-run hint: install the app instead of leaving it in a tab.
 *
 * Shown only in a browser tab, only until it is dismissed, and never once
 * the app is installed (`useInstallHint`). It is *a hint, not a prompt*:
 * `beforeinstallprompt` is Chromium-only and fires on nobody's schedule,
 * and iOS Safari — the likeliest phone here — has no such event at all, so
 * one sentence pointing at the browser's own menu works everywhere and
 * needs no event plumbing.
 *
 * It sits in the normal flow at the very top of the shell (see `App.tsx`),
 * above the screen rather than over it: a floating banner would sooner or
 * later cover the cart bar, a pay button or the nav.
 */
export function InstallHint() {
  const { visible, dismiss } = useInstallHint()

  if (!visible) return null

  return (
    <aside className="install-hint" aria-label="Install this app">
      <p className="install-hint-text">
        Add this to your Home screen — open your browser&rsquo;s menu and choose{' '}
        <strong>Add to Home screen</strong>. It then opens full-screen and keeps working with no
        signal.
      </p>
      <button type="button" className="install-hint-dismiss" onClick={dismiss}>
        Got it
      </button>
    </aside>
  )
}
