import { useLiveQuery } from 'dexie-react-hooks'
import { useEffect } from 'react'
import { db } from './db/db'
import { seedIfEmpty } from './db/seed'
import { formatBaht } from './domain/money'

/**
 * Placeholder shell. PLAN.md task 2 replaces this with the real
 * ProductGrid + Cart screens. It exists so `npm run dev` shows something
 * and proves Dexie + seed data work on the device.
 */
export default function App() {
  useEffect(() => {
    void seedIfEmpty()
  }, [])

  const products = useLiveQuery(() =>
    // Booleans are not indexable in IndexedDB, so filter in JS after the index scan.
    db.products
      .orderBy('sortOrder')
      .filter((p) => !p.archived)
      .toArray(),
  )

  return (
    <main className="app">
      <h1>Bakery POS</h1>
      <p className="muted">Scaffold running. Products loaded from local DB:</p>
      <ul className="grid">
        {(products ?? []).map((p) => (
          <li key={p.id} className="tile">
            <span>{p.name}</span>
            <strong>{formatBaht(p.price)}</strong>
          </li>
        ))}
      </ul>
    </main>
  )
}
