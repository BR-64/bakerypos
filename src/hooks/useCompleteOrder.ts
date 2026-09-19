import { useCallback, useRef, useState } from 'react'
import type { PosDatabase } from '../db/db'
import { completeOrder } from '../db/orders'
import { safeString } from '../domain/log'
import type { CartLine, Order, Payment } from '../domain/types'

export interface CompleteOrder {
  /** True from the first `complete()` until it fails. Disable every button while true. */
  pending: boolean
  /** Staff-facing message after a failed save, else null. Show it in a `role="alert"`. */
  error: string | null
  /** Store the order. Extra calls while one is in flight are ignored. */
  complete: (payment: Payment) => void
}

/**
 * The one way a checkout screen (Cash, PromptPay) stores a sale.
 *
 * A ref guards synchronously, so a double tap — even two clicks in the same
 * event loop turn, before React re-renders with `pending` — creates exactly
 * one order. On success it calls `onOrderComplete(order)` exactly once, even
 * if the screen has unmounted meanwhile (the order is already in Dexie, so
 * the cart must still be cleared), and leaves `pending` true because App is
 * about to leave the screen. On failure it logs, sets `error`, re-enables,
 * and leaves the cart untouched so staff can retry.
 */
export function useCompleteOrder(
  lines: CartLine[],
  database: PosDatabase,
  onOrderComplete: (order: Order) => void,
): CompleteOrder {
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const complete = useCallback(
    (payment: Payment) => {
      if (inFlight.current) return
      inFlight.current = true
      setPending(true)
      setError(null)
      completeOrder(lines, payment, database).then(
        (order) => onOrderComplete(order),
        (err: unknown) => {
          const reason = err instanceof Error ? err.message : safeString(err)
          console.error(`useCompleteOrder: order not saved: ${reason}`)
          inFlight.current = false
          setPending(false)
          setError("Couldn't save the order. The cart is unchanged — try again.")
        },
      )
    },
    [lines, database, onOrderComplete],
  )

  return { pending, error, complete }
}
