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
 * Bad-data rule: a product with an invalid price (non-integer, negative,
 * NaN or missing) or an empty/missing name must never crash the tile or
 * become addable — `formatBaht` is never called with an invalid price,
 * since it can produce garbage for non-integer/negative input. Such a tile
 * renders disabled with a neutral "Unavailable" label and logs once via
 * console.error so the bad record can be found and fixed later.
 */
export function ProductTile({ product, onAdd }: ProductTileProps) {
  if (!isSellable(product)) {
    console.error(
      `ProductTile: product "${product.id}" is not sellable (name=${JSON.stringify(product.name)}, price=${product.price}) — showing as unavailable`,
    )
    const label = typeof product.name === 'string' && product.name.trim() ? product.name : 'Unavailable'
    return (
      <button type="button" className="tile tile-disabled" disabled>
        <span>{label}</span>
        <strong>Unavailable</strong>
      </button>
    )
  }

  const priceLabel = formatBaht(product.price)

  if (product.outOfStock) {
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
