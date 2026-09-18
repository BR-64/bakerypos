import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { CartBar } from '../components/CartBar'
import { CategoryTabs } from '../components/CategoryTabs'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { ProductTile } from '../components/ProductTile'
import { db, type PosDatabase } from '../db/db'
import { sellableProducts } from '../db/products'
import { productsInCategory, visibleCategories, type CategoryTab } from '../domain/categories'
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
 * The product grid is wrapped in its own `ErrorBoundary`: `useLiveQuery`
 * re-throws during render if the query rejects (so it can be caught by a
 * boundary), and that must show a recoverable message rather than take
 * down the cart bar and category tabs with it. `App` wraps this whole
 * screen in another `ErrorBoundary` as a further safety net.
 */
export function SellScreen({ cart, onOpenCart, database = db }: SellScreenProps) {
  return (
    <main className="app sell-screen">
      <ErrorBoundary>
        <ProductGrid cart={cart} onOpenCart={onOpenCart} database={database} />
      </ErrorBoundary>
    </main>
  )
}

interface ProductGridProps {
  cart: Pick<Cart, 'add' | 'count' | 'total'>
  onOpenCart?: () => void
  database: PosDatabase
}

function ProductGrid({ cart, onOpenCart, database }: ProductGridProps) {
  const [selectedTab, setSelectedTab] = useState<CategoryTab>('all')
  const products = useLiveQuery(() => sellableProducts(database), [database])

  if (products === undefined) {
    return <p className="sell-screen-message muted">Loading menu…</p>
  }

  if (products.length === 0) {
    return <p className="sell-screen-message muted">No products yet.</p>
  }

  const categories = visibleCategories(products)
  const visibleProducts = productsInCategory(products, selectedTab)

  return (
    <>
      <CategoryTabs categories={categories} selected={selectedTab} onSelect={setSelectedTab} />
      <ul className="grid sell-grid">
        {visibleProducts.map((product) => (
          <li key={product.id}>
            <ProductTile product={product} onAdd={cart.add} />
          </li>
        ))}
      </ul>
      <CartBar count={cart.count} total={cart.total} onOpen={onOpenCart} />
    </>
  )
}
