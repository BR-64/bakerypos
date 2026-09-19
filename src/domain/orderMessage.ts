import { formatBaht } from './money'
import type { Order } from './types'

/** How long the "order completed" confirmation stays up before dismissing itself. */
export const ORDER_TOAST_MS = 5000

/**
 * Confirmation shown on Sell after a sale completes, e.g.
 * "Order #12 — change ฿45" (cash) or "Order #13 — paid" (PromptPay).
 */
export function orderCompleteMessage(order: Order): string {
  if (order.payment.method === 'cash') {
    return `Order #${order.number} — change ${formatBaht(order.payment.change)}`
  }
  return `Order #${order.number} — paid`
}
