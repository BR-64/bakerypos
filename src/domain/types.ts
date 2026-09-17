/**
 * Domain model for the bakery POS.
 *
 * Conventions (enforced in CLAUDE.md):
 * - All money is an integer number of satang (1 baht = 100 satang). Never floats.
 * - IDs are client-generated UUIDs so offline-created records never collide.
 * - Timestamps are ISO-8601 strings created on the device.
 * - Nothing is hard-deleted. Orders are voided, products are archived.
 */

export type Satang = number

export type Category = 'bread' | 'pastry' | 'cake' | 'drink' | 'other'

export interface Product {
  id: string
  name: string
  /** Current sell price. Copied onto OrderLine.unitPrice at time of sale. */
  price: Satang
  category: Category
  /** Sort position in the product grid. */
  sortOrder: number
  /** Bakeries sell out; staff toggle this from the admin screen. */
  outOfStock: boolean
  /** Archived products stay in the DB so old orders still reference them. */
  archived: boolean
}

export interface OrderLine {
  productId: string
  /** Snapshot of the product name at time of sale. */
  name: string
  /** Snapshot of the price at time of sale — price changes must not rewrite history. */
  unitPrice: Satang
  qty: number
}

export type PaymentMethod = 'cash' | 'promptpay'

export interface CashPayment {
  method: 'cash'
  /** What the customer handed over. */
  tendered: Satang
  /** tendered - total. Always >= 0 for a completed order. */
  change: Satang
}

export interface PromptPayPayment {
  method: 'promptpay'
  /** Staff confirm manually after seeing the bank notification. */
  confirmedAt: string
}

export type Payment = CashPayment | PromptPayPayment

export type OrderStatus = 'completed' | 'voided'
export type SyncStatus = 'pending' | 'synced'

export interface Order {
  id: string
  /** Human-friendly per-device running number shown on the receipt, e.g. 42. */
  number: number
  lines: OrderLine[]
  /** Sum of unitPrice * qty across lines. Stored, not recomputed, so reports are stable. */
  total: Satang
  payment: Payment
  status: OrderStatus
  createdAt: string
  voidedAt?: string
  voidReason?: string
  /** Local-first: orders are written locally first and pushed to the server later. */
  sync: SyncStatus
}

/** In-memory cart before it becomes an Order. */
export interface CartLine extends OrderLine {}
