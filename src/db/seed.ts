import { bahtToSatang } from '../domain/money'
import type { Product } from '../domain/types'
import { db } from './db'

/** Starter menu. Replace with the real one from the admin screen. */
export const seedProducts: Product[] = [
  {
    id: 'p-croissant',
    name: 'Croissant',
    price: bahtToSatang(55),
    category: 'pastry',
    sortOrder: 1,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-pain-choc',
    name: 'Pain au Chocolat',
    price: bahtToSatang(65),
    category: 'pastry',
    sortOrder: 2,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-sourdough',
    name: 'Sourdough Loaf',
    price: bahtToSatang(120),
    category: 'bread',
    sortOrder: 3,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-baguette',
    name: 'Baguette',
    price: bahtToSatang(60),
    category: 'bread',
    sortOrder: 4,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-cinnamon',
    name: 'Cinnamon Roll',
    price: bahtToSatang(70),
    category: 'pastry',
    sortOrder: 5,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-banana-cake',
    name: 'Banana Cake Slice',
    price: bahtToSatang(75),
    category: 'cake',
    sortOrder: 6,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-cookie',
    name: 'Chocolate Chip Cookie',
    price: bahtToSatang(40),
    category: 'pastry',
    sortOrder: 7,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-americano',
    name: 'Iced Americano',
    price: bahtToSatang(65),
    category: 'drink',
    sortOrder: 8,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-latte',
    name: 'Iced Latte',
    price: bahtToSatang(75),
    category: 'drink',
    sortOrder: 9,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-thai-tea',
    name: 'Thai Milk Tea',
    price: bahtToSatang(55),
    category: 'drink',
    sortOrder: 10,
    outOfStock: false,
    archived: false,
  },
]

/** Insert the seed menu only if the products table is empty. Safe to call on every startup. */
export async function seedIfEmpty(database = db): Promise<void> {
  const count = await database.products.count()
  if (count === 0) {
    await database.products.bulkAdd(seedProducts)
  }
}
