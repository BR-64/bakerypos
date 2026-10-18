import { useId } from 'react'
import { isSellable } from '../domain/cart'
import { formatBaht } from '../domain/money'
import { readStock, stockLabel } from '../domain/stock'
import type { Product } from '../domain/types'
import { useProductImage } from '../hooks/useProductImage'

export interface ProductTileProps {
  product: Product
  onAdd: (product: Product) => void
}

/**
 * One tile in the Sell screen grid. Tapping an in-stock, well-formed
 * product calls `onAdd`. The button's accessible name is its visible text,
 * which always includes the product name and (when valid) the formatted
 * price — except a tracked stock count, which is the button's description
 * rather than part of its name.
 *
 * `SellScreen` filters invalid products out before they ever reach this
 * component (via `partitionSellable`, which also logs them) — invalid data
 * is skipped and logged, never shown. `isSellable` here is only a
 * defensive last-resort guard against a caller passing bad data directly:
 * it renders nothing, and never logs (the caller is responsible for
 * logging once, since a tile re-rendering many times must not spam the
 * console).
 *
 * The picture lives in `SellableTile` rather than here so that guard stays
 * a plain early return: `useProductImage` is a hook and so cannot run
 * after one, and running it for a product we are about to refuse to render
 * would mean logging about the picture on a tile that never appears.
 */
export function ProductTile({ product, onAdd }: ProductTileProps) {
  if (!isSellable(product)) return null
  return <SellableTile product={product} onAdd={onAdd} />
}

/**
 * The tile proper, for a product already known to be sellable.
 *
 * A picture is decoration: `useProductImage` returns `null` for a product
 * with no photo and no shipped file, which is the normal case, and then no
 * `<img>` is rendered at all — the tile is the name and price it has
 * always been. Name and price sit *under* the picture rather than over it,
 * so they are read against the tile's own background and no photo can make
 * a price hard to read.
 *
 * The picture's box is reserved by `aspect-ratio` in CSS from the first
 * render, so the grid does not reflow as pictures decode. The `<img>` is
 * `pointer-events: none` (see `.tile-image`), so every tap inside the tile
 * lands on the button and not on an image drag.
 */
function SellableTile({ product, onAdd }: ProductTileProps) {
  const picture = useProductImage(product)
  const priceLabel = formatBaht(product.price)
  const ids = useId()
  const nameId = `${ids}-name`
  const priceId = `${ids}-price`
  const soldOutId = `${ids}-sold-out`
  const stockId = `${ids}-stock`

  // Informational only (task 8d): a count never disables a tile, and an
  // untracked or unreadable count shows nothing. `SellScreen` logs the
  // unreadable ones once; the tile stays silent.
  const reading = readStock(product)
  const stock = reading.kind === 'tracked' ? stockLabel(reading.level) : null
  const stockLine =
    stock === null ? null : (
      <span id={stockId} className={stock.low ? 'tile-stock tile-stock-low' : 'tile-stock'}>
        {stock.text}
      </span>
    )
  // With a count shown, the button's name is pinned to exactly what it was
  // before stock existed ("Croissant ฿55", plus "Sold out") and the count
  // is its description instead — a screen reader still hears it, after the
  // name, and nothing that finds a tile by its name changes as stock moves.
  const labelling = (soldOut: boolean) =>
    stock === null
      ? {}
      : {
          'aria-labelledby': [nameId, priceId, ...(soldOut ? [soldOutId] : [])].join(' '),
          'aria-describedby': stockId,
        }

  const media =
    picture.src === null ? null : (
      <span className="tile-media">
        <img
          className="tile-image"
          src={picture.src}
          // Empty on purpose: the button's accessible name already says the
          // product name, and a real `alt` here would read it out twice.
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={picture.onError}
        />
      </span>
    )

  if (product.outOfStock === true) {
    return (
      <button type="button" className="tile tile-disabled" disabled {...labelling(true)}>
        {media}
        <span id={nameId}>{product.name}</span>
        <strong id={priceId}>{priceLabel}</strong>
        {stockLine}
        <span id={soldOutId} className="tile-sold-out">
          Sold out
        </span>
      </button>
    )
  }

  return (
    <button type="button" className="tile" onClick={() => onAdd(product)} {...labelling(false)}>
      {media}
      <span id={nameId}>{product.name}</span>
      <strong id={priceId}>{priceLabel}</strong>
      {stockLine}
    </button>
  )
}
