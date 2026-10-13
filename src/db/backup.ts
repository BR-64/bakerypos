import type { EntityTable } from 'dexie'
import {
  readExportedSettings,
  sameProduct,
  settingsChanges,
  validateBackup,
  type BackupPayload,
  type PriceChange,
  type SettingsChange,
} from '../domain/backup'
import { SETTINGS_ID } from '../domain/settings'
import type { Order, Product } from '../domain/types'
import { db, type PosDatabase } from './db'
import { readSettings, updateSettings } from './settings'

/**
 * What an import did, or would do. The screen shows this **before** the
 * merge (from `previewImport`) and again after it (from `importBackup`),
 * so nothing outside the orders table ever changes unannounced.
 */
export interface ImportSummary {
  /** Products in the file. */
  products: number
  /** Orders in the file. */
  orders: number
  /** Products the device has never seen. Always added. */
  newProducts: number
  /** Products already on the device. */
  existingProducts: number
  /** How many of those differ from the file — replaced only if details are opted in. */
  changedProducts: number
  /** How many were *actually* replaced. Always 0 from `previewImport`. */
  replacedProducts: number
  /** Orders that will be (or were) added. */
  newOrders: number
  /** Orders already on the device: **left exactly as they are**. */
  existingOrders: number
  /**
   * Imported orders whose human `number` is already used by an order on
   * this phone — two receipts reading "#1". Reported, never renumbered:
   * the number is printed on the source device's receipts and rewriting
   * it here would make the two copies disagree about which sale is which.
   */
  numberCollisions: number
  /** Shop settings the file would change, with both values. Never the PIN. */
  settingsChanges: SettingsChange[]
  /** Price moves among `changedProducts`, for the confirmation to name. */
  priceChanges: PriceChange[]
  /** Whether the shop settings were *actually* written. False from `previewImport`. */
  settingsApplied: boolean
  /**
   * What the "also replace details" choice should start as: on only for a
   * device with nothing of its own to lose — no settings row, and not one
   * of the file's products already here.
   */
  replaceDetailsByDefault: boolean
}

export interface ImportOptions {
  /**
   * Replace the shop settings and the details of products already here.
   * **Off by default**, because both change what the till charges and who
   * it pays. Orders merge either way — recovering sales is the point.
   */
  replaceDetails?: boolean
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

/** How the file's products compare with what's stored, product by product. */
interface ProductComparison {
  known: Set<string>
  changed: Product[]
  priceChanges: PriceChange[]
  /** The stored row for each id the device already has, for `keepingImages`. */
  stored: Map<string, Product>
}

async function compareProducts(
  database: PosDatabase,
  products: Product[],
): Promise<ProductComparison> {
  const known = new Set<string>()
  const changed: Product[] = []
  const priceChanges: PriceChange[] = []
  const rows = new Map<string, Product>()
  if (products.length === 0) return { known, changed, priceChanges, stored: rows }

  const stored = await database.products.bulkGet(products.map((product) => product.id))
  products.forEach((incoming, index) => {
    const current = stored[index]
    if (current === undefined) return
    known.add(incoming.id)
    rows.set(incoming.id, current)
    if (sameProduct(current, incoming)) return
    changed.push(incoming)
    if (current.price !== incoming.price) {
      priceChanges.push({
        id: incoming.id,
        // The name the owner is looking at on this phone right now.
        name: current.name,
        from: current.price,
        to: incoming.price,
      })
    }
  })
  return { known, changed, priceChanges, stored: rows }
}

/**
 * The file's products, each carrying forward the picture already on this
 * phone.
 *
 * A backup never contains pictures (they are device-only — see
 * `buildExport`'s allowlist), and replacing product details is a `put`,
 * which writes the whole row. Without this, ticking "also replace product
 * details" would silently wipe every photo the owner had taken — a
 * destructive side effect of a choice that is only supposed to be about
 * names, prices, categories and positions. `sameProduct` ignores `image`
 * for the same reason, so a photo never makes a product look "changed".
 */
function keepingImages(products: Product[], stored: Map<string, Product>): Product[] {
  return products.map((product) => {
    const image = stored.get(product.id)?.image
    return image === undefined ? product : { ...product, image }
  })
}

/**
 * How many of `orders` would land on a human number this device has
 * already used. Reachable on one kiosk: clear the storage, ring up #1–#3,
 * then import yesterday's backup of #1–#40.
 */
async function countNumberCollisions(database: PosDatabase, orders: Order[]): Promise<number> {
  if (orders.length === 0) return 0
  const numbers = orders.map((order) => order.number)
  const used = new Set(await database.orders.where('number').anyOf(numbers).keys())
  return orders.filter((order) => used.has(order.number)).length
}

/** The stored shop details, plus whether there is a settings row at all. */
async function storedDetails(
  database: PosDatabase,
): Promise<{ settings: ReturnType<typeof readExportedSettings>; hasRow: boolean }> {
  try {
    const row = await database.settings.get(SETTINGS_ID)
    return { settings: readExportedSettings(row), hasRow: row !== undefined }
  } catch {
    // A read that failed is not a blank device: assume there is something
    // here to lose, so the replace-details choice defaults to off.
    return { settings: readExportedSettings(undefined), hasRow: true }
  }
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

/** Re-validate before touching anything; the payload may not have come from `parseImport`. */
function checked(payload: BackupPayload): BackupPayload {
  const result = validateBackup(payload)
  if (!result.ok) throw new Error(result.error)
  return result.payload
}

/**
 * What `importBackup` would do, without doing any of it. Read-only.
 *
 * Everything the confirmation needs to be honest: the counts, the orders
 * that would collide on a number, each shop setting that would change and
 * what it would change from, and the products already here that the file
 * would overwrite.
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
  const incomingOrders = valid.orders.filter((order) => !knownOrderIds.has(order.id))
  const products = await compareProducts(database, valid.products)
  const details = await storedDetails(database)

  return {
    products: valid.products.length,
    orders: valid.orders.length,
    newProducts: valid.products.length - products.known.size,
    existingProducts: products.known.size,
    changedProducts: products.changed.length,
    replacedProducts: 0,
    newOrders: incomingOrders.length,
    existingOrders: knownOrderIds.size,
    numberCollisions: await countNumberCollisions(database, incomingOrders),
    settingsChanges: settingsChanges(details.settings, valid.settings),
    priceChanges: products.priceChanges,
    settingsApplied: false,
    replaceDetailsByDefault: !details.hasRow && products.known.size === 0,
  }
}

/**
 * Merge a backup into this device, in **one** transaction.
 *
 * Four rules, in order of how much they matter:
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
 *    (`settingsPatch`). If the settings read fails, this throws, the
 *    transaction rolls back, and nothing at all is imported — better than
 *    importing orders while silently dropping the settings.
 * 4. **Everything outside the orders table is opt-in.** Without
 *    `replaceDetails`, a product already here keeps its name, price,
 *    category, position and stock state, and the shop settings are not
 *    touched at all. Restoring an old backup to recover lost sales must
 *    not quietly reprice the Sell grid or point PromptPay at an account
 *    the shop closed months ago. Products the device has never seen are
 *    added either way — there is nothing of the owner's to overwrite.
 *
 * Old orders are unaffected whatever is chosen: every line carries its own
 * name and price snapshot, and `Order.total` is stored, not recomputed.
 *
 * The payload is re-validated first (`checked`), before the transaction
 * opens, so a corrupt file is refused whole with no partial write.
 */
export async function importBackup(
  payload: BackupPayload,
  database: PosDatabase = db,
  options: ImportOptions = {},
): Promise<ImportSummary> {
  const valid = checked(payload)
  const replaceDetails = options.replaceDetails === true
  const patch = settingsPatch(valid)

  return database.transaction(
    'rw',
    database.products,
    database.orders,
    database.settings,
    async () => {
      const knownOrderIds = await existingIds(database.orders, valid.orders)
      const newOrders: Order[] = valid.orders.filter((order) => !knownOrderIds.has(order.id))
      const products = await compareProducts(database, valid.products)
      const newProducts = valid.products.filter((product) => !products.known.has(product.id))
      const collisions = await countNumberCollisions(database, newOrders)
      const details = await storedDetails(database)

      if (newOrders.length > 0) await database.orders.bulkAdd(newOrders)
      if (replaceDetails) {
        if (valid.products.length > 0) {
          await database.products.bulkPut(keepingImages(valid.products, products.stored))
        }
      } else if (newProducts.length > 0) {
        await database.products.bulkAdd(newProducts)
      }

      let settingsApplied = false
      let changes: SettingsChange[] = settingsChanges(details.settings, valid.settings)
      if (replaceDetails) {
        // Read again, through the reader that *reports* a failure rather
        // than falling back silently: about to overwrite the shop's
        // settings is exactly the wrong moment to be comparing against
        // defaults we invented because a read broke.
        const current = await readSettings(database)
        if (current.failed) {
          throw new Error("Couldn't read the current settings, so nothing was imported.")
        }
        changes = settingsChanges(readExportedSettings(current.settings), valid.settings)
        if (changes.length > 0) {
          await updateSettings(patch, database)
          settingsApplied = true
        }
      }

      return {
        products: valid.products.length,
        orders: valid.orders.length,
        newProducts: newProducts.length,
        existingProducts: products.known.size,
        changedProducts: products.changed.length,
        replacedProducts: replaceDetails ? products.changed.length : 0,
        newOrders: newOrders.length,
        existingOrders: knownOrderIds.size,
        numberCollisions: collisions,
        settingsChanges: changes,
        priceChanges: products.priceChanges,
        settingsApplied,
        replaceDetailsByDefault: !details.hasRow && products.known.size === 0,
      }
    },
  )
}
