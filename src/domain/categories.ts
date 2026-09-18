import type { Category, Product } from './types'

/**
 * Pure helpers for the Sell screen's category tabs. No React, no Dexie —
 * these operate on plain arrays of `Product` so they're trivially testable.
 */

/** Fixed tab order. A later task may make this configurable per shop. */
export const CATEGORY_ORDER: Category[] = ['bread', 'pastry', 'cake', 'drink', 'other']

const CATEGORY_LABELS: Record<Category, string> = {
  bread: 'Bread',
  pastry: 'Pastry',
  cake: 'Cake',
  drink: 'Drinks',
  other: 'Other',
}

/**
 * English label for a category tab. Bad-data safe: a product loaded from a
 * corrupted or hand-edited record can carry a category that isn't one of
 * our known `Category` values, and this must never throw — it falls back to
 * a neutral label instead.
 */
export function categoryLabel(category: Category): string {
  return Object.hasOwn(CATEGORY_LABELS, category) ? CATEGORY_LABELS[category] : 'Other'
}

/** Whether `category` is one of the known, orderable categories. */
function isKnownCategory(category: unknown): category is Category {
  return typeof category === 'string' && (CATEGORY_ORDER as string[]).includes(category)
}

/**
 * Which category tabs to show: only categories with at least one product,
 * in `CATEGORY_ORDER` order. A category whose only product is out of stock
 * still counts — out-of-stock products stay visible (disabled) in the grid.
 *
 * Bad-data safe: products with an unknown or missing category are ignored
 * here (they still show under the "All" tab via `productsInCategory`), so a
 * corrupt category value never throws and never invents a stray tab.
 */
export function visibleCategories(products: Product[]): Category[] {
  const present = new Set(products.filter((p) => isKnownCategory(p.category)).map((p) => p.category))
  return CATEGORY_ORDER.filter((c) => present.has(c))
}

/** A tab id: one of the known categories, or 'all' for every product. */
export type CategoryTab = Category | 'all'

/**
 * Products to show for the selected tab, keeping `sortOrder`. `'all'`
 * returns every product unfiltered — including ones with an unknown or
 * missing category, so bad data never makes a product vanish from the
 * screen entirely.
 */
export function productsInCategory(products: Product[], tab: CategoryTab): Product[] {
  if (tab === 'all') return products
  return products.filter((p) => p.category === tab)
}
