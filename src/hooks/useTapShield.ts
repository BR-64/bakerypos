import { useCallback, useEffect, useRef, useState } from 'react'

/** How long a raised shield blocks taps for. */
export const TAP_SHIELD_MS = 400

export interface TapShield {
  /** True from the moment `raise()` is called until `TAP_SHIELD_MS` later. */
  active: boolean
  /**
   * (Re)start the shield. Calling this while already active restarts the
   * full duration rather than stacking — one timer is ever running.
   */
  raise: () => void
}

/**
 * A timed "ignore taps" flag. On its own this hook does nothing to the DOM;
 * `App` wires `active` into capture-phase `onClickCapture`/
 * `onPointerDownCapture` handlers on `.screen-wrap` (never a CSS overlay —
 * jsdom does no hit-testing, so an overlay-based shield would pass its
 * tests while leaving the real behaviour untested/broken).
 *
 * The motivating case: right after a cash sale completes, the screen
 * returns to Sell in the same tap gesture that paid — without this, that
 * same physical tap (or one immediately following it, before the finger has
 * lifted) can land on a product tile now sitting where "Done" used to be,
 * silently starting a new sale nobody rang up.
 */
export function useTapShield(): TapShield {
  const [active, setActive] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const raise = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current)
    setActive(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setActive(false)
    }, TAP_SHIELD_MS)
  }, [])

  // No timer must outlive the component that owns it.
  useEffect(() => {
    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [])

  return { active, raise }
}
