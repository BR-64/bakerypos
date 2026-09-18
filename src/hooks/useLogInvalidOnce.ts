import { useEffect, useRef } from 'react'

/**
 * Logs each item in `invalid` exactly once, no matter how many times this
 * runs — callers typically recompute `invalid` fresh on every
 * render/emission (e.g. `partitionSellable`/`partitionCartLines` return new
 * arrays each time), so the actual de-duplication lives in `loggedKeys`,
 * which persists across renders via a ref, keyed by `keyOf(item)`.
 *
 * Runs in an effect, never in the render body itself, per CLAUDE.md:
 * invalid data is "skipped and logged, never thrown" — and logging is a
 * side effect, not something to do while rendering.
 *
 * `keyOf` and `describe` are the caller's responsibility to make crash-safe
 * (typically via `safeString`, since the invalid items are untrusted,
 * possibly-corrupt records) — this hook does not wrap them further.
 */
export function useLogInvalidOnce<T>(
  invalid: T[],
  keyOf: (item: T) => string,
  describe: (item: T) => string,
): void {
  const loggedKeys = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const item of invalid) {
      const key = keyOf(item)
      if (loggedKeys.current.has(key)) continue
      loggedKeys.current.add(key)
      console.error(describe(item))
    }
  }, [invalid, keyOf, describe])
}
