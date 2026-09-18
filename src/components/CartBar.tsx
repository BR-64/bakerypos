import { formatBaht } from '../domain/money'
import type { Satang } from '../domain/types'

export interface CartBarProps {
  count: number
  total: Satang
  onOpen?: () => void
}

/**
 * Sticky bottom bar showing the current cart count and total. Tapping it
 * opens the cart screen (wired up in a later task). Disabled when the cart
 * is empty or when no `onOpen` handler is given. Rendered unconditionally
 * by `SellScreen` — loading, empty-menu and error states never hide it, so
 * the cart is always reachable.
 */
export function CartBar({ count, total, onOpen }: CartBarProps) {
  const label = `Cart: ${count} item${count === 1 ? '' : 's'}, ${formatBaht(total)}`
  return (
    <button
      type="button"
      className="cart-bar"
      onClick={onOpen}
      disabled={count === 0 || !onOpen}
      aria-label={label}
    >
      <span className="cart-bar-count">{count}</span>
      <span className="cart-bar-total">{formatBaht(total)}</span>
    </button>
  )
}
