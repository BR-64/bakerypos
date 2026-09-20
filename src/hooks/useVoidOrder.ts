import { useCallback, useRef, useState } from 'react'
import type { PosDatabase } from '../db/db'
import { voidOrder as voidOrderInDb } from '../db/orders'
import { safeString } from '../domain/log'

export interface VoidOrder {
  /**
   * True from the first `voidOrder()` call until it settles. Unlike
   * `useCompleteOrder`'s `pending` (which stays true on success because App
   * is about to leave the screen), this returns to `false` on success too —
   * the Orders screen stays mounted, showing the now-voided order in place.
   */
  pending: boolean
  /** Staff-facing message after a failed void, else null. Show it in a `role="alert"`. */
  error: string | null
  /** Void the order. Extra calls while one is in flight are ignored. */
  voidOrder: (id: string, reason: string) => void
}

/**
 * The one way the Orders screen voids an order. Mirrors
 * `useCompleteOrder`'s synchronous in-flight ref, so a double tap on
 * "Yes, void" — even two clicks in the same event loop turn, before React
 * re-renders with `pending` — voids the order exactly once.
 */
export function useVoidOrder(database: PosDatabase): VoidOrder {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const voidOrder = useCallback(
    (id: string, reason: string) => {
      if (inFlight.current) return
      inFlight.current = true
      setPending(true)
      setError(null)
      voidOrderInDb(id, reason, database).then(
        () => {
          inFlight.current = false
          setPending(false)
        },
        (err: unknown) => {
          const message = err instanceof Error ? err.message : safeString(err)
          console.error(`useVoidOrder: order not voided: ${message}`)
          inFlight.current = false
          setPending(false)
          setError("Couldn't void the order. The order is unchanged — try again.")
        },
      )
    },
    [database],
  )

  return { pending, error, voidOrder }
}
