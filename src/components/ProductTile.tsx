import { isSellable } from '../domain/cart'
import { formatBaht } from '../domain/money'
import type { Product } from '../domain/types'

export interface ProductTileProps {
  product: Product
  onAdd: (product: Product) => void
}

/**
 * One tile in the Sell screen grid. Tapping an in-stock, well-formed
 * product calls `onAdd`. The button's accessible name is its visible text,
 * which always includes the product name and (when valid) the formatted
 * price.
 *
 * `SellScreen` filters invalid products out before they ever reach this
 * component (via `partitionSellable`, which also logs them) — invalid data
 * is skipped and logged, never shown. `isSellable` here is only a
 * defensive last-resort guard against a caller passing bad data directly:
 * it renders nothing, and never logs (the caller is responsible for
 * logging once, since a tile re-rendering many times must not spam the
 * console).
 */
export function ProductTile({ product, onAdd }: ProductTileProps) {
  if (!isSellable(product)) return null

  const priceLabel = formatBaht(product.price)

  if (product.outOfStock === true) {
    return (
      <button type="button" className="tile tile-disabled" disabled>
        <span>{product.name}</span>
        <strong>{priceLabel}</strong>
        <span className="tile-sold-out">Sold out</span>
      </button>
    )
  }

  return (
    <button type="button" className="tile" onClick={() => onAdd(product)}>
      <span>{product.name}</span>
      <strong>{priceLabel}</strong>
    </button>
  )
}
