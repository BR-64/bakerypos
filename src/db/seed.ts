import { bahtToSatang } from '../domain/money'
import type { Product } from '../domain/types'
import { db } from './db'

/** Starter menu. Replace with the real one from the admin screen. */
export const seedProducts: Product[] = [
  {
    id: 'p-brownie-9',
    name: 'Brownie 9 cubes',
    price: bahtToSatang(300),
    category: 'brownies',
    sortOrder: 1,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-brownie-21',
    name: 'Brownie 21 cubes',
    price: bahtToSatang(680),
    category: 'brownies',
    sortOrder: 2,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-brownie-brittles',
    name: 'Brownie brittles',
    price: bahtToSatang(380),
    category: 'brownies',
    sortOrder: 3,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-brownie-cups',
    name: 'Brownie cups',
    price: bahtToSatang(60),
    category: 'brownies',
    sortOrder: 4,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-choc-chunk',
    name: 'Choc chunk',
    price: bahtToSatang(125),
    category: 'cookies',
    sortOrder: 5,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-macadamia-choc',
    name: 'Macadamia choc',
    price: bahtToSatang(125),
    category: 'cookies',
    sortOrder: 6,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-manhattan',
    name: 'Manhattan',
    price: bahtToSatang(125),
    category: 'cookies',
    sortOrder: 7,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-amsterdam',
    name: 'Amsterdam cookies',
    price: bahtToSatang(125),
    category: 'cookies',
    sortOrder: 8,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-seasalt-choc-mud',
    name: 'Seasalt choc mud',
    price: bahtToSatang(125),
    category: 'cookies',
    sortOrder: 9,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-cake-jar',
    name: 'Cake jar',
    price: bahtToSatang(250),
    category: 'jar',
    sortOrder: 10,
    outOfStock: false,
    archived: false,
  },
  {
    id: 'p-cookie-jar',
    name: 'Cookie jar',
    price: bahtToSatang(380),
    category: 'jar',
    sortOrder: 11,
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
