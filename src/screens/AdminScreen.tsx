import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import './AdminScreen.css'
import { BackupSection } from '../components/BackupSection'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { PinPrompt } from '../components/PinPrompt'
import { db, type PosDatabase } from '../db/db'
import {
  allProducts,
  archiveProduct,
  createProduct,
  setProductOutOfStock,
  updateProduct,
} from '../db/products'
import { updateSettings } from '../db/settings'
import { partitionSellable } from '../domain/cart'
import { categoryLabel, CATEGORY_ORDER } from '../domain/categories'
import { safeString } from '../domain/log'
import { formatBaht, formatBahtInput } from '../domain/money'
import { isValidPromptPayId } from '../domain/promptpay'
import {
  validateProductDraft,
  MAX_PRODUCT_NAME_LENGTH,
  type ProductDraft,
  type ProductValues,
} from '../domain/productDraft'
import { MAX_SHOP_NAME_LENGTH, type Settings } from '../domain/settings'
import type { Category, Product } from '../domain/types'
import { useLogInvalidOnce } from '../hooks/useLogInvalidOnce'
import type { PinLock } from '../hooks/usePinLock'

export interface AdminScreenProps {
  database?: PosDatabase
  /** Stored settings, or `null` while the first read is in flight. */
  settings: Settings | null
  /** True when that read failed — the shop settings are then not editable. */
  settingsFailed?: boolean
  /** Shared PIN lock from App. Admin renders the keypad until it's unlocked. */
  pinLock: PinLock
}

/** Turn any thrown value into something safe to show a person. */
function errorMessage(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : safeString(error)
  console.error(`AdminScreen: ${fallback} — ${text}`)
  return text.length > 0 ? text : fallback
}

/**
 * The owner's screen: the menu (add, edit name/price/category, sold-out
 * toggle, archive) and the shop settings (name, PromptPay ID, category
 * order).
 *
 * It is behind the PIN (`docs/SPEC.md`): until `pinLock.unlocked` this
 * renders nothing but the keypad, so the prices on an unattended phone
 * can't be edited by whoever picks it up. Sell, Cart, checkout and Report
 * never ask for a PIN.
 *
 * Nothing here is on the checkout path, but the same rules still apply:
 * prices are integer satang throughout (`parseBahtInput` does the typing),
 * archiving is never a delete, and every product read from Dexie goes
 * through `partitionSellable` so one corrupt record can't take the screen
 * down.
 */
export function AdminScreen({
  database = db,
  settings,
  settingsFailed = false,
  pinLock,
}: AdminScreenProps) {
  const [retryKey, setRetryKey] = useState(0)

  if (!pinLock.unlocked) {
    return (
      <main className="app screen admin-screen">
        <h1 className="admin-title">Admin</h1>
        <PinPrompt
          settings={settings}
          settingsFailed={settingsFailed}
          lock={pinLock}
          database={database}
          purpose="Admin"
        />
      </main>
    )
  }

  return (
    <main className="app screen admin-screen">
      <header className="admin-header">
        <h1 className="admin-title">Admin</h1>
        <button type="button" className="admin-lock-button" onClick={pinLock.lock}>
          Lock
        </button>
      </header>

      {settingsFailed ? (
        <p className="checkout-error" role="alert">
          Couldn&rsquo;t read the shop settings, so they can&rsquo;t be changed here without
          overwriting them. The menu below is still editable.
        </p>
      ) : settings === null ? (
        <p className="admin-message muted">Loading shop settings…</p>
      ) : (
        <>
          {/* Deliberately *not* keyed on the stored values: `settings`
              comes from a live query, so a successful save re-emits it and
              a key like that would remount this form and throw away the
              "Saved" confirmation the owner is waiting for. The fields hold
              what was typed; the initial values only matter on mount. */}
          <ShopSettingsForm settings={settings} database={database} />
          <CategoryOrderEditor settings={settings} database={database} />
        </>
      )}

      {/* Same inner-boundary pattern as SellScreen's grid and OrdersScreen:
          `useLiveQuery` re-throws a rejected query during render, and the
          settings above must stay usable when the product read is what
          broke. */}
      <ErrorBoundary key={retryKey} onRetry={() => setRetryKey((k) => k + 1)}>
        <ProductAdmin database={database} />
      </ErrorBoundary>

      {/* Its own boundary: Backup reads every order on the device, and a
          rejected read there must not take the menu above down with it. */}
      <ErrorBoundary key={`backup-${retryKey}`} onRetry={() => setRetryKey((k) => k + 1)}>
        <BackupSection database={database} />
      </ErrorBoundary>
    </main>
  )
}

interface ShopSettingsFormProps {
  settings: Settings
  database: PosDatabase
}

/**
 * Shop name and PromptPay ID.
 *
 * The fields start from the stored row and are then the owner's to edit;
 * they are not re-synced from later re-emissions of `settings`, so a save
 * landing (and the live query re-emitting) can't wipe the "Saved"
 * confirmation or a half-typed field. Saving goes through
 * `updateSettings`, which merges into the stored row inside a transaction
 * — this form must never be able to blank the PromptPay ID or the PIN.
 */
function ShopSettingsForm({ settings, database }: ShopSettingsFormProps) {
  const [shopName, setShopName] = useState(settings.shopName)
  const [promptPayId, setPromptPayId] = useState(settings.promptPayId)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)

  async function save(): Promise<void> {
    if (busy) return
    const name = shopName.trim()
    if (name.length === 0 || name.length > MAX_SHOP_NAME_LENGTH) {
      setError(`Shop name must be 1–${MAX_SHOP_NAME_LENGTH} characters.`)
      setSaved(false)
      return
    }
    const id = promptPayId.trim()
    if (!isValidPromptPayId(id)) {
      setError('PromptPay ID must be a 10-digit phone number or a 13-digit ID, digits only.')
      setSaved(false)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await updateSettings({ shopName: name, promptPayId: id }, database)
      setSaved(true)
    } catch (thrown) {
      setError(errorMessage(thrown, "Couldn't save the shop settings"))
      setSaved(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-section" aria-label="Shop settings">
      <h2 className="admin-section-heading">Shop</h2>
      <label className="admin-field">
        <span className="admin-field-label">Shop name</span>
        <input
          type="text"
          className="admin-input"
          value={shopName}
          maxLength={MAX_SHOP_NAME_LENGTH}
          disabled={busy}
          onChange={(event) => {
            setShopName(event.target.value)
            setSaved(false)
          }}
        />
      </label>
      <label className="admin-field">
        <span className="admin-field-label">PromptPay ID</span>
        <input
          type="text"
          className="admin-input"
          inputMode="numeric"
          value={promptPayId}
          disabled={busy}
          onChange={(event) => {
            setPromptPayId(event.target.value)
            setSaved(false)
          }}
        />
      </label>
      {error && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-actions">
        {saved && <span className="admin-saved muted">Saved</span>}
        <button
          type="button"
          className="admin-primary-button"
          disabled={busy}
          onClick={() => void save()}
        >
          Save shop settings
        </button>
      </div>
    </section>
  )
}

interface CategoryOrderEditorProps {
  settings: Settings
  database: PosDatabase
}

/** Reorder the Sell screen's category tabs. Each move is saved straight away. */
function CategoryOrderEditor({ settings, database }: CategoryOrderEditorProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const order = settings.categoryOrder

  async function move(index: number, delta: number): Promise<void> {
    const target = index + delta
    if (busy || target < 0 || target >= order.length) return
    const next = [...order]
    const [moved] = next.splice(index, 1)
    next.splice(target, 0, moved)
    setBusy(true)
    setError(null)
    try {
      await updateSettings({ categoryOrder: next }, database)
    } catch (thrown) {
      setError(errorMessage(thrown, "Couldn't save the category order"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="admin-section" aria-label="Category order">
      <h2 className="admin-section-heading">Category order</h2>
      <p className="admin-message muted">The order of the tabs on the Sell screen.</p>
      {error && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}
      <ol className="admin-category-list">
        {order.map((category: Category, index) => (
          <li key={category} className="admin-category-row">
            <span className="admin-category-name">{categoryLabel(category)}</span>
            <button
              type="button"
              className="admin-move-button"
              aria-label={`Move ${categoryLabel(category)} up`}
              disabled={busy || index === 0}
              onClick={() => void move(index, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              className="admin-move-button"
              aria-label={`Move ${categoryLabel(category)} down`}
              disabled={busy || index === order.length - 1}
              onClick={() => void move(index, 1)}
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Dedup key for an invalid product, mirroring SellScreen's. */
function invalidProductKey(product: Product): string {
  return typeof product.id === 'string' && product.id.length > 0 ? product.id : safeString(product)
}

function describeInvalidProduct(product: Product): string {
  return `AdminScreen: skipping invalid product ${invalidProductKey(product)} — ${safeString(product)}`
}

function ProductAdmin({ database }: { database: PosDatabase }) {
  const products = useLiveQuery(() => allProducts(database), [database])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmArchiveId, setConfirmArchiveId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { sellable: valid, invalid } = partitionSellable(products ?? [])
  useLogInvalidOnce(invalid, invalidProductKey, describeInvalidProduct)

  async function run(action: () => Promise<unknown>, fallback: string): Promise<boolean> {
    setError(null)
    try {
      await action()
      return true
    } catch (thrown) {
      setError(errorMessage(thrown, fallback))
      return false
    }
  }

  if (products === undefined) {
    return <p className="admin-message muted">Loading menu…</p>
  }

  return (
    <section className="admin-section" aria-label="Products">
      <h2 className="admin-section-heading">Menu</h2>
      {error && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}

      <ul className="admin-product-list">
        {valid.map((product) =>
          editingId === product.id ? (
            <li key={product.id} className="admin-product">
              <ProductForm
                initial={product}
                submitLabel="Save product"
                onCancel={() => setEditingId(null)}
                onSubmit={async (values) => {
                  const ok = await run(
                    () => updateProduct(product.id, values, database),
                    "Couldn't save the product",
                  )
                  if (ok) setEditingId(null)
                  return ok
                }}
              />
            </li>
          ) : (
            <li key={product.id} className="admin-product">
              <div className="admin-product-row">
                <span className="admin-product-name">{product.name}</span>
                <span className="admin-product-price">{formatBaht(product.price)}</span>
                <span className="admin-product-category muted">
                  {categoryLabel(product.category)}
                </span>
                {product.outOfStock === true && <span className="admin-badge">Sold out</span>}
                {product.archived === true && <span className="admin-badge">Archived</span>}
              </div>
              {confirmArchiveId === product.id ? (
                <div
                  className="admin-product-actions"
                  role="group"
                  aria-label={`Archive ${product.name}?`}
                >
                  <span className="admin-message">Archive {product.name}?</span>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    onClick={() => setConfirmArchiveId(null)}
                  >
                    Keep
                  </button>
                  <button
                    type="button"
                    className="admin-danger-button"
                    onClick={() => {
                      void run(
                        () => archiveProduct(product.id, true, database),
                        "Couldn't archive the product",
                      ).then(() => setConfirmArchiveId(null))
                    }}
                  >
                    Yes, archive
                  </button>
                </div>
              ) : (
                <div className="admin-product-actions">
                  <button
                    type="button"
                    className="admin-secondary-button"
                    onClick={() => {
                      setAdding(false)
                      setEditingId(product.id)
                    }}
                  >
                    Edit {product.name}
                  </button>
                  <button
                    type="button"
                    className="admin-secondary-button"
                    onClick={() =>
                      void run(
                        () =>
                          setProductOutOfStock(product.id, product.outOfStock !== true, database),
                        "Couldn't change the stock state",
                      )
                    }
                  >
                    {product.outOfStock === true
                      ? `Mark ${product.name} in stock`
                      : `Mark ${product.name} sold out`}
                  </button>
                  {product.archived === true ? (
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() =>
                        void run(
                          () => archiveProduct(product.id, false, database),
                          "Couldn't restore the product",
                        )
                      }
                    >
                      Restore {product.name}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="admin-secondary-button"
                      onClick={() => setConfirmArchiveId(product.id)}
                    >
                      Archive {product.name}
                    </button>
                  )}
                </div>
              )}
            </li>
          ),
        )}
      </ul>

      {/* Corrupt records are hidden rather than silently dropped, the same
          way the Sell screen and Orders handle them. */}
      {invalid.length > 0 && (
        <p className="admin-message muted">
          {invalid.length} product{invalid.length === 1 ? '' : 's'} couldn&rsquo;t be displayed.
        </p>
      )}

      {adding ? (
        <ProductForm
          submitLabel="Add product"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const ok = await run(() => createProduct(values, database), "Couldn't add the product")
            if (ok) setAdding(false)
            return ok
          }}
        />
      ) : (
        <button
          type="button"
          className="admin-primary-button"
          onClick={() => {
            setEditingId(null)
            setAdding(true)
          }}
        >
          Add product
        </button>
      )}
    </section>
  )
}

interface ProductFormProps {
  initial?: Product
  submitLabel: string
  onCancel: () => void
  /** Resolves true when the write succeeded, so the form can stay open on failure. */
  onSubmit: (values: ProductValues) => Promise<boolean>
}

/**
 * The add/edit form. The price is typed in baht and stored as integer
 * satang by `validateProductDraft` — never a float, and never a value the
 * form guessed at.
 */
function ProductForm({ initial, submitLabel, onCancel, onSubmit }: ProductFormProps) {
  const [draft, setDraft] = useState<ProductDraft>({
    name: initial?.name ?? '',
    price: initial === undefined ? '' : formatBahtInput(initial.price),
    category: initial?.category ?? 'brownies',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(): Promise<void> {
    if (busy) return
    const result = validateProductDraft(draft)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError(null)
    setBusy(true)
    try {
      await onSubmit(result.values)
    } finally {
      setBusy(false)
    }
  }

  const nameLabel = initial === undefined ? 'New product name' : `Name for ${initial.name}`
  const priceLabel = initial === undefined ? 'New product price' : `Price for ${initial.name}`
  const categoryLabelText =
    initial === undefined ? 'New product category' : `Category for ${initial.name}`

  return (
    <div className="admin-product-form">
      <label className="admin-field">
        <span className="admin-field-label">{nameLabel}</span>
        <input
          type="text"
          className="admin-input"
          value={draft.name}
          maxLength={MAX_PRODUCT_NAME_LENGTH}
          disabled={busy}
          onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
        />
      </label>
      <label className="admin-field">
        <span className="admin-field-label">{priceLabel}</span>
        <input
          type="text"
          className="admin-input"
          inputMode="decimal"
          placeholder="45.50"
          value={draft.price}
          disabled={busy}
          onChange={(event) => setDraft((d) => ({ ...d, price: event.target.value }))}
        />
      </label>
      <label className="admin-field">
        <span className="admin-field-label">{categoryLabelText}</span>
        <select
          className="admin-input"
          value={draft.category}
          disabled={busy}
          onChange={(event) => setDraft((d) => ({ ...d, category: event.target.value }))}
        >
          {CATEGORY_ORDER.map((category) => (
            <option key={category} value={category}>
              {categoryLabel(category)}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p className="checkout-error" role="alert">
          {error}
        </p>
      )}
      <div className="admin-actions">
        <button type="button" className="admin-secondary-button" disabled={busy} onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="admin-primary-button"
          disabled={busy}
          onClick={() => void submit()}
        >
          {submitLabel}
        </button>
      </div>
    </div>
  )
}
