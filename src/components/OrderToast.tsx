import { useEffect } from 'react'
import { ORDER_TOAST_MS, orderCompleteMessage } from '../domain/orderMessage'
import type { Order } from '../domain/types'

export interface OrderToastProps {
  order: Order
  onDismiss: () => void
}

/**
 * "Order #N — change ฿X" confirmation after a sale. The whole toast is one
 * ≥48px button: tapping it dismisses it, and it dismisses itself after
 * ORDER_TOAST_MS. App renders it inside a permanent `role="status"` region
 * so screen readers announce it when it appears.
 */
export function OrderToast({ order, onDismiss }: OrderToastProps) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, ORDER_TOAST_MS)
    return () => clearTimeout(timer)
  }, [order.id, onDismiss])

  return (
    <button type="button" className="order-toast" onClick={onDismiss}>
      {orderCompleteMessage(order)}
    </button>
  )
}
