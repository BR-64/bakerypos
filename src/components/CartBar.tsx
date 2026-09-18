import { formatBaht } from '../domain/money'

export interface CartBarProps {
  count: number
  total: number
  onOpen?: () => void
}

/**
 * Sticky bottom bar showing the current cart count and total. Tapping it
 * opens the cart screen (wired up in a later task). Disabled when the cart
 * is empty or when no `onOpen` handler is given.
 */
export function CartBar({ count, total, onOpen }: CartBarProps) {
  return (
    <button
      type="button"
      className="cart-bar"
      onClick={onOpen}
      disabled={count === 0 || !onOpen}
    >
      <span className="cart-bar-count">{count}</span>
      <span className="cart-bar-total">{formatBaht(total)}</span>
    </button>
  )
}
