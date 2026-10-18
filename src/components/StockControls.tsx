import { useLiveQuery } from 'dexie-react-hooks'
import { useId, useRef, useState } from 'react'
import { db, type PosDatabase } from '../db/db'
import { receiveStock, setStockCount, stockHistory } from '../db/stock'
import { formatLocalTime, localDayKey } from '../domain/day'
import { safeString } from '../domain/log'
import {
  parseReceivedQty,
  parseStockCount,
  partitionStockMovements,
  readStock,
  type StockInputResult,
} from '../domain/stock'
import type { Product, StockMovement } from '../domain/types'
import { useLogInvalidOnce } from '../hooks/useLogInvalidOnce'
import { ErrorBoundary } from './ErrorBoundary'

export interface StockControlsProps {
  product: Product
  database?: PosDatabase
}

/** How many movements "History" shows (and `stockHistory` reads). */
const HISTORY_LIMIT = 50

type Mode = 'idle' | 'set' | 'received'

interface ModeCopy {
  groupLabel: string
  inputLabel: string
  parse: (text: string) => StockInputResult
  write: (id: string, value: number, database: PosDatabase) => Promise<unknown>
  fallback: string
}

const MODES: Record<Exclude<Mode, 'idle'>, (name: string) => ModeCopy> = {
  set: (name) => ({
    groupLabel: `Stocktake for ${name}`,
    inputLabel: `New count for ${name}`,
    parse: parseStockCount,
    write: setStockCount,
    fallback: "Couldn't save the count",
  }),
  received: (name) => ({
    groupLabel: `Delivery for ${name}`,
    inputLabel: `How many ${name} arrived`,
    parse: parseReceivedQty,
    write: receiveStock,
    fallback: "Couldn't add the delivery",
  }),
}

/**
 * Admin's stock controls for one product (task 8d): the current count,
 * "Set count" (a stocktake — also how tracking starts, and how an
 * unreadable count is repaired), "+ Received" (a delivery, only once a
 * count exists) and the latest history.
 *
 * Only ever rendered inside Admin's product list, which is behind the PIN,
 * so whoever picks up an unattended phone can't change a count.
 *
 * `product` comes from Admin's live query, already through
 * `partitionSellable`; its `stock` is still read with `readStock`, since a
 * product can be well-formed while its count is not. Every write is
 * `setStockCount`/`receiveStock`, which re-read the row inside their own
 * transaction — this component never computes a new count itself.
 */
export function StockControls({ product, database = db }: StockControlsProps) {
  const [mode, setMode] = useState<Mode>('idle')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)
  // A ref as well as state: two taps landing in the same frame both see
  // `pending === false`, and only one of them may write.
  const inFlight = useRef(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyRetry, setHistoryRetry] = useState(0)
  const historyId = useId()

  const reading = readStock(product)
  const name = product.name

  function open(next: Exclude<Mode, 'idle'>): void {
    setMode(next)
    setText('')
    setError(null)
  }

  function close(): void {
    setMode('idle')
    setText('')
    setError(null)
  }

  async function save(): Promise<void> {
    if (mode === 'idle' || inFlight.current) return
    const copy = MODES[mode](name)
    const parsed = copy.parse(text)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    inFlight.current = true
    setPending(true)
    setError(null)
    try {
      await copy.write(product.id, parsed.value, database)
      close()
    } catch (thrown) {
      const message = thrown instanceof Error ? thrown.message : safeString(thrown)
      console.error(`StockControls: ${copy.fallback} for ${product.id} — ${message}`)
      setError(message.length > 0 ? message : copy.fallback)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  const copy = mode === 'idle' ? null : MODES[mode](name)

  return (
    <div className="stock-controls">
      <p
        className={
          reading.kind === 'tracked' && reading.level <= 0
            ? 'stock-status stock-status-low'
            : 'stock-status'
        }
      >
        {reading.kind === 'tracked'
          ? `Stock: ${reading.level}`
          : reading.kind === 'untracked'
            ? 'Not tracked'
            : 'Stock unreadable — set a count'}
      </p>

      {copy !== null ? (
        <div className="stock-form" role="group" aria-label={copy.groupLabel}>
          <label className="admin-field">
            <span className="admin-field-label">{copy.inputLabel}</span>
            <input
              type="text"
              className="admin-input"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={text}
              disabled={pending}
              onChange={(event) => {
                setText(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void save()
              }}
            />
          </label>
          {error !== null && (
            <p className="checkout-error" role="alert">
              {error}
            </p>
          )}
          <div className="admin-actions">
            <button
              type="button"
              className="admin-secondary-button"
              disabled={pending}
              onClick={close}
            >
              Cancel
            </button>
            <button
              type="button"
              className="admin-primary-button"
              disabled={pending}
              onClick={() => void save()}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="admin-product-actions">
          <button type="button" className="admin-secondary-button" onClick={() => open('set')}>
            Set count for {name}
          </button>
          {reading.kind === 'tracked' && (
            <button
              type="button"
              className="admin-secondary-button"
              onClick={() => open('received')}
            >
              + Received for {name}
            </button>
          )}
        </div>
      )}

      <div className="admin-product-actions stock-history-toggle">
        <button
          type="button"
          className="admin-secondary-button"
          aria-expanded={historyOpen}
          aria-controls={historyOpen ? historyId : undefined}
          onClick={() => setHistoryOpen((isOpen) => !isOpen)}
        >
          History for {name}
        </button>
      </div>

      {historyOpen && (
        <div id={historyId} className="stock-history">
          {/* Its own boundary, like OrdersScreen's: `useLiveQuery`
              re-throws a rejected read during render, and a broken history
              must not take the product row (or the menu) down with it. */}
          <ErrorBoundary key={historyRetry} onRetry={() => setHistoryRetry((k) => k + 1)}>
            <StockHistory productId={product.id} database={database} />
          </ErrorBoundary>
        </div>
      )}
    </div>
  )
}

function invalidMovementKey(movement: unknown): string {
  if (typeof movement === 'object' && movement !== null) {
    const id = (movement as Record<string, unknown>).id
    if (typeof id === 'string' && id.length > 0) return id
  }
  return safeString(movement)
}

function describeInvalidMovement(movement: unknown): string {
  return `StockControls: skipping invalid stock movement ${invalidMovementKey(movement)} — ${safeString(movement)}`
}

function kindLabel(movement: StockMovement): string {
  switch (movement.kind) {
    case 'sale':
      return movement.orderNumber === undefined ? 'Sale' : `Sale #${movement.orderNumber}`
    case 'void':
      return movement.orderNumber === undefined ? 'Void' : `Void #${movement.orderNumber}`
    case 'set':
      return 'Count'
    case 'received':
      return 'Received'
  }
}

function signed(delta: number): string {
  return delta > 0 ? `+${delta}` : String(delta)
}

/**
 * The latest `HISTORY_LIMIT` movements for one product, newest first. Rows
 * come straight from Dexie, so they go through `partitionStockMovements`:
 * a corrupt row is skipped, logged once and counted in the footer — never
 * shown half-read, never thrown.
 */
function StockHistory({ productId, database }: { productId: string; database: PosDatabase }) {
  const rows = useLiveQuery(
    () => stockHistory(productId, database, HISTORY_LIMIT),
    [productId, database],
  )
  const { valid, invalid } = partitionStockMovements(rows ?? [])
  useLogInvalidOnce(invalid, invalidMovementKey, describeInvalidMovement)

  if (rows === undefined) return <p className="admin-message muted">Loading history…</p>

  return (
    <>
      {valid.length === 0 ? (
        <p className="admin-message muted">No stock changes yet.</p>
      ) : (
        <ol className="stock-history-list" aria-label="Stock history">
          {valid.map((movement) => {
            const at = new Date(movement.createdAt)
            return (
              <li key={movement.id} className="stock-history-row">
                <span className="stock-history-when muted">
                  {localDayKey(at)} {formatLocalTime(movement.createdAt)}
                </span>
                <span className="stock-history-kind">{kindLabel(movement)}</span>
                <span className="stock-history-delta">{signed(movement.delta)}</span>
                <span className="stock-history-level">now {movement.level}</span>
              </li>
            )
          })}
        </ol>
      )}
      {rows.length >= HISTORY_LIMIT && (
        <p className="admin-message muted">Showing the latest {HISTORY_LIMIT}.</p>
      )}
      {invalid.length > 0 && (
        <p className="admin-message muted stock-history-invalid">
          {invalid.length} entr{invalid.length === 1 ? 'y' : 'ies'} couldn&rsquo;t be displayed.
        </p>
      )}
    </>
  )
}
