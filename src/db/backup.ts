import type { EntityTable } from 'dexie'
import { validateBackup, type BackupPayload } from '../domain/backup'
import type { Order, Product } from '../domain/types'
import { db, type PosDatabase } from './db'
import { readSettings, updateSettings } from './settings'

/**
 * What an import did, or would do. The screen shows this **before** the
 * merge (from `previewImport`) and again after it (from `importBackup`),
 * so "N new / N already present" is never a surprise.
 */
export interface ImportSummary {
  /** Products in the file. */
  products: number
  /** Orders in the file. */
  orders: number
  /** Products the device has never seen — the rest are updated in place. */
  newProducts: number
  existingProducts: number
  /** Orders that will be (or were) added. */
  newOrders: number
  /** Orders already on the device: **left exactly as they are**. */
  existingOrders: number
  /** Whether the shop settings differ from the stored ones. Never the PIN. */
  settingsChanged: boolean
}

/** Ids of `rows` that already exist in `table`, as a Set. */
async function existingIds<T extends { id: string }>(
  table: EntityTable<T, 'id'>,
  rows: { id: string }[],
): Promise<Set<string>> {
  if (rows.length === 0) return new Set()
  const ids = rows.map((row) => row.id)
  const found = await table.where('id').anyOf(ids).primaryKeys()
  return new Set(found as string[])
}

/**
 * Only ever these three fields reach the settings row. Written out by hand
 * rather than spread from the payload so that no field a file invented —
 * above all `pinHash`, `pinSalt`, `recoveryHash` or `lockedUntil` — can
 * ride along. An import must never be a way to unlock Admin or change the
 * PIN.
 */
function settingsPatch(payload: BackupPayload) {
  return {
    shopName: payload.settings.shopName,
    promptPayId: payload.settings.promptPayId,
    categoryOrder: [...payload.settings.categoryOrder],
  }
}

function differsFromStored(
  patch: ReturnType<typeof settingsPatch>,
  stored: { shopName: string; promptPayId: string; categoryOrder: string[] },
): boolean {
  return (
    patch.shopName !== stored.shopName ||
    patch.promptPayId !== stored.promptPayId ||
    patch.categoryOrder.length !== stored.categoryOrder.length ||
    patch.categoryOrder.some((category, index) => category !== stored.categoryOrder[index])
  )
}

/** Re-validate before touching anything; the payload may not have come from `parseImport`. */
function checked(payload: BackupPayload): BackupPayload {
  const result = validateBackup(payload)
  if (!result.ok) throw new Error(result.error)
  return result.payload
}

/**
 * What `importBackup` would do, without doing any of it. Read-only.
 *
 * The counts are recomputed inside the merge transaction anyway — this is
 * for the confirmation the owner sees, not something the write trusts.
 */
export async function previewImport(
  payload: BackupPayload,
  database: PosDatabase = db,
): Promise<ImportSummary> {
  const valid = checked(payload)
  const knownOrderIds = await existingIds(database.orders, valid.orders)
  const knownProductIds = await existingIds(database.products, valid.products)
  const current = await readSettings(database)
  return {
    products: valid.products.length,
    orders: valid.orders.length,
    newProducts: valid.products.length - knownProductIds.size,
    existingProducts: knownProductIds.size,
    newOrders: valid.orders.length - knownOrderIds.size,
    existingOrders: knownOrderIds.size,
    settingsChanged: current.failed
      ? false
      : differsFromStored(settingsPatch(valid), current.settings),
  }
}

/**
 * Merge a backup into this device, in **one** transaction.
 *
 * Three rules, in order of how much they matter:
 *
 * 1. **An existing order is never overwritten.** Orders are the money
 *    record and history is never rewritten (CLAUDE.md), so the merge adds
 *    only ids the device has never seen and leaves every order it already
 *    has exactly as it is — right down to a void the backup predates.
 *    Importing the same file twice therefore adds nothing the second time.
 * 2. **Nothing is deleted.** A record the file doesn't mention stays.
 *    Import is a merge, never a restore-over.
 * 3. **The PIN is untouchable.** Settings go through `updateSettings`,
 *    which merges a patch into the stored row inside this same
 *    transaction, and the patch is the three shop fields and nothing else
 *    (`settingsPatch`). If the settings read fails, `updateSettings`
 *    throws, the transaction rolls back, and nothing at all is imported —
 *    better than importing orders while silently dropping the settings.
 *
 * Products *are* updated in place: they are current state, not history,
 * and a rename or a price correction in the backup is the point of
 * restoring one. Old orders are unaffected either way — every line
 * carries its own name and price snapshot.
 *
 * The payload is re-validated first (`checked`), before the transaction
 * opens, so a corrupt file is refused whole with no partial write.
 */
export async function importBackup(
  payload: BackupPayload,
  database: PosDatabase = db,
): Promise<ImportSummary> {
  const valid = checked(payload)
  const patch = settingsPatch(valid)

  return database.transaction(
    'rw',
    database.products,
    database.orders,
    database.settings,
    async () => {
      const knownOrderIds = await existingIds(database.orders, valid.orders)
      const knownProductIds = await existingIds(database.products, valid.products)
      const newOrders: Order[] = valid.orders.filter((order) => !knownOrderIds.has(order.id))
      const products: Product[] = valid.products

      if (newOrders.length > 0) await database.orders.bulkAdd(newOrders)
      if (products.length > 0) await database.products.bulkPut(products)

      const before = await readSettings(database)
      const settingsChanged = !before.failed && differsFromStored(patch, before.settings)
      // Runs even when nothing differs: `updateSettings` is the only
      // writer that can't blank the PIN, and calling it unconditionally
      // keeps that the single path.
      await updateSettings(patch, database)

      return {
        products: products.length,
        orders: valid.orders.length,
        newProducts: products.length - knownProductIds.size,
        existingProducts: knownProductIds.size,
        newOrders: newOrders.length,
        existingOrders: knownOrderIds.size,
        settingsChanged,
      }
    },
  )
}
