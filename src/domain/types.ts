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

export type Category = 'brownies' | 'cookies' | 'jar' | 'other'

/**
 * A photo taken in Admin, stored on this device only.
 *
 * Why a `Blob` and not a data URL: IndexedDB stores a Blob natively via
 * structured clone, and `URL.createObjectURL` takes one directly — so
 * neither the write nor the read ever copies a few hundred KB of image
 * through a JS string, and the Sell grid's first paint stays cheap. A
 * base64 data URL would be ~33% larger at rest and would have to be
 * re-parsed on every live-query emission.
 *
 * Why `width`/`height` are stored alongside it: they let a record be
 * checked for corruption *without decoding the blob* (a synchronous,
 * zero-cost guard on the checkout path) and they pin that the long edge
 * really is within `MAX_IMAGE_EDGE` at rest. The tile does not need them
 * for layout — it reserves a fixed-aspect box, so nothing reflows when a
 * picture decodes.
 *
 * Not indexed, so this needs no new Dexie version (see `src/db/db.ts`).
 * Never copied onto an `OrderLine`: order history and receipts stay text.
 */
export interface ProductImage {
  /** Re-encoded and downscaled by `resizeImageFile` — never the raw camera file. */
  blob: Blob
  /** `'image/webp'`, or `'image/jpeg'` where WebP encoding isn't available. */
  type: string
  /** Pixel width of `blob`. */
  width: number
  /** Pixel height of `blob`. */
  height: number
}

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
  /**
   * Optional photo, uploaded in Admin and kept on this device. Absent is
   * the normal state, not an error: the tile then looks for a picture
   * shipped in the repo (`public/products/<id>.webp`) and falls back to
   * name + price. Deliberately left out of backups — see
   * `src/domain/backup.ts`.
   */
  image?: ProductImage
  /**
   * How many are on hand, when this product's stock is tracked (task 8d).
   * Absent = untracked — the normal state until Admin's "Set count". May go
   * below 0 (a sale is never blocked by stock) and never changes
   * `outOfStock`. A present value that isn't a safe integer is unreadable
   * and treated as untracked everywhere (see `readStock` in
   * `src/domain/stock.ts`). Unindexed, so no new Dexie version for
   * `products`; device-only, like `image`, so never in a backup.
   */
  stock?: number
}

/**
 * Why a product's stock count moved. `sale` and `void` are written by
 * `completeOrder`/`voidOrder` in the same transaction as the order; `set`
 * (a stocktake) and `received` (a delivery) by Admin.
 */
export type StockMovementKind = 'sale' | 'void' | 'set' | 'received'

/**
 * One line of a product's stock history. Append-only and history only: the
 * current count lives on `Product.stock`, never summed from these.
 */
export interface StockMovement {
  id: string
  productId: string
  kind: StockMovementKind
  /** Signed safe integer: -2 for a sale of two, +2 for its void. */
  delta: number
  /** The product's stock after this movement. */
  level: number
  /** The stock before it; `null` when it was untracked or unreadable (a `set` repair). */
  previous: number | null
  /** `Date#toISOString()`. */
  createdAt: string
  /** The order a `sale`/`void` belongs to. Absent for `set`/`received`. */
  orderId?: string
  /** That order's human number, for "Sale #42" in the history. */
  orderNumber?: number
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
