import { categoryLabel, type CategoryTab } from '../domain/categories'
import type { Category } from '../domain/types'

export interface CategoryTabsProps {
  categories: Category[]
  selected: CategoryTab
  onSelect: (tab: CategoryTab) => void
}

/**
 * Horizontally-scrolling row of category tabs above the product grid. An
 * "All" tab always comes first. Each tab is at least `var(--tap)` tall.
 */
export function CategoryTabs({ categories, selected, onSelect }: CategoryTabsProps) {
  const tabs: CategoryTab[] = ['all', ...categories]

  return (
    <div role="tablist" aria-label="Product categories" className="category-tabs">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          role="tab"
          aria-selected={tab === selected}
          className="category-tab"
          onClick={() => onSelect(tab)}
        >
          {tab === 'all' ? 'All' : categoryLabel(tab)}
        </button>
      ))}
    </div>
  )
}
