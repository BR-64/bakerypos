import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect, useRef, useState } from 'react'
import { CartBar } from '../components/CartBar'
import { CategoryTabs } from '../components/CategoryTabs'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ProductTile } from '../components/ProductTile'
import { db, type PosDatabase } from '../db/db'
import { sellableProducts } from '../db/products'
import { partitionSellable } from '../domain/cart'
import { productsInCategory, visibleCategories, type CategoryTab } from '../domain/categories'
import { safeString } from '../domain/log'
import type { Product } from '../domain/types'
import type { Cart } from '../hooks/useCart'

export interface SellScreenProps {
  cart: Pick<Cart, 'add' | 'count' | 'total'>
  onOpenCart?: () => void
  database?: PosDatabase
}

/**
 * The main kiosk screen: category tabs, a product grid loaded live from
 * Dexie, and a sticky cart bar. Tapping a tile adds it to `cart` — no
 * network call anywhere in this path.
 *
 * `CartBar` is a sibling of the query-consuming `ProductGrid`, not a child
 * of it, and is rendered unconditionally here — a rejected product query,
 * the loading state, and the empty-menu state must never take the cart bar
 * (and the cart it represents) down with them.
 *
 * `ProductGrid` is wrapped in its own `ErrorBoundary`: `useLiveQuery`
 * re-throws during render if the query rejects (so it can be caught by a
 * boundary). The fallback's "Try again" changes `retryKey`, which remounts
 * both the boundary and `ProductGrid` fresh, retrying the query; "Reload"
 * reloads the whole page. `App` wraps this whole screen in another
 * `ErrorBoundary` as a further safety net for anything unforeseen
 * elsewhere.
 */
export function SellScreen({ cart, onOpenCart, database = db }: SellScreenProps) {
  const [retryKey, setRetryKey] = useState(0)

  return (
    <main className="app sell-screen">
      <ErrorBoundary key={retryKey} onRetry={() => setRetryKey((k) => k + 1)}>
        <ProductGrid cart={cart} database={database} />
      </ErrorBoundary>
      <CartBar count={cart.count} total={cart.total} onOpen={onOpenCart} />
    </main>
  )
}

interface ProductGridProps {
  cart: Pick<Cart, 'add' | 'count' | 'total'>
  database: PosDatabase
}

/**
 * Logs each invalid product once (keyed by id, or by a stringified copy of
 * the record when even the id is missing), no matter how many times this
 * runs — `partitionSellable` returns a fresh `invalid` array on every
 * emission/render, so the actual de-duplication lives in `loggedKeys`,
 * which persists across renders via a ref. Runs in an effect, never in the
 * render body itself, per CLAUDE.md: invalid data is "skipped and logged,
 * never thrown" — and logging is a side effect, not something to do while
 * rendering.
 */
function useLogInvalidProductsOnce(invalid: Product[]): void {
  const loggedKeys = useRef<Set<string>>(new Set())

  useEffect(() => {
    for (const product of invalid) {
      const key =
        typeof product.id === 'string' && product.id.length > 0 ? product.id : safeString(product)
      if (loggedKeys.current.has(key)) continue
      loggedKeys.current.add(key)
      console.error(
        `SellScreen: skipping invalid product ${key} — ` +
          `id=${safeString(product.id)}, name=${safeString(product.name)}, ` +
          `price=${safeString(product.price)}, sortOrder=${safeString(product.sortOrder)}, ` +
          `archived=${safeString(product.archived)}, outOfStock=${safeString(product.outOfStock)}`,
      )
    }
  }, [invalid])
}

function ProductGrid({ cart, database }: ProductGridProps) {
  const [selectedTab, setSelectedTab] = useState<CategoryTab>('all')
  const products = useLiveQuery(() => sellableProducts(database), [database])

  const { sellable, invalid } = partitionSellable(products ?? [])
  useLogInvalidProductsOnce(invalid)

  if (products === undefined) {
    return <p className="sell-screen-message muted">Loading menu…</p>
  }

  if (sellable.length === 0) {
    return <p className="sell-screen-message muted">No products yet.</p>
  }

  const categories = visibleCategories(sellable)
  // If the previously-selected tab's category has disappeared (its last
  // product went out of scope, e.g. archived live while the screen was
  // open), fall back to "All" for both the grid and the tab's
  // aria-selected, instead of silently showing an empty grid under a tab
  // that no longer exists.
  const effectiveTab: CategoryTab =
    selectedTab === 'all' || categories.includes(selectedTab) ? selectedTab : 'all'
  const visibleProducts = productsInCategory(sellable, effectiveTab)

  return (
    <>
      <CategoryTabs categories={categories} selected={effectiveTab} onSelect={setSelectedTab} />
      <ul className="grid">
        {visibleProducts.map((product) => (
          <li key={product.id}>
            <ProductTile product={product} onAdd={cart.add} />
          </li>
        ))}
      </ul>
    </>
  )
}
