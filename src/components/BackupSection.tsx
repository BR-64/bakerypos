import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import './BackupSection.css'
import { importBackup, previewImport, type ImportSummary } from '../db/backup'
import { db, type PosDatabase } from '../db/db'
import { allProducts } from '../db/products'
import { getSettings } from '../db/settings'
import {
  backupFileName,
  buildExport,
  buildOrdersCsv,
  ordersCsvFileName,
  parseImport,
  MAX_IMPORT_BYTES,
  TOO_LARGE_MESSAGE,
  UTF8_BOM,
  type BackupPayload,
} from '../domain/backup'
import { safeString } from '../domain/log'
import { formatBaht } from '../domain/money'
import { useShareFiles } from '../hooks/useShareFiles'

export interface BackupSectionProps {
  database?: PosDatabase
}

/** A parsed file, and what importing it would do — shown before anything is written. */
interface PendingImport {
  fileName: string
  payload: BackupPayload
  summary: ImportSummary
}

function message(error: unknown, fallback: string): string {
  const text = error instanceof Error ? error.message : safeString(error)
  console.error(`BackupSection: ${fallback} — ${text}`)
  return text.length > 0 ? text : fallback
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** "a", "a and b", "a, b and c" — for the Import button's honest label. */
function listed(parts: string[]): string {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/**
 * The warning for imported orders that would repeat a number already used
 * here. Built as one string so the sentence reads as one sentence to a
 * screen reader, and so the grammar survives a count of exactly one.
 */
function collisionNote(count: number): string {
  return `${plural(count, 'imported order')} ${count === 1 ? 'shares' : 'share'} a number with an order already on this phone. Both are kept, so two receipts will show the same number.`
}

/** Whether this file would change anything outside the orders table. */
function hasDetailChanges(summary: ImportSummary): boolean {
  return summary.settingsChanges.length > 0 || summary.changedProducts > 0
}

/**
 * Admin → Backup: take the whole shop off the phone as a file, and merge
 * one back.
 *
 * Behind the PIN, like the rest of Admin — it can read out every sale the
 * shop has made. Nothing here touches the network: the file goes to the
 * phone's own share sheet (or a download link), which is the entire point
 * on a kiosk whose Wi-Fi comes and goes.
 *
 * The export data is loaded and held ready rather than fetched on the tap,
 * because `navigator.share` has to be called inside the gesture — see
 * `useShareFiles`. An import, by contrast, is deliberately two taps:
 * choose the file, read exactly what it would change — including the shop
 * settings and the prices on the Sell grid, which are opt-in — and *then*
 * apply it.
 */
export function BackupSection({ database = db }: BackupSectionProps) {
  const data = useLiveQuery(async () => {
    const [products, orders, settings] = await Promise.all([
      allProducts(database),
      database.orders.toArray(),
      getSettings(database),
    ])
    return { products, orders, settings }
  }, [database])

  const share = useShareFiles()
  const [exportNote, setExportNote] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [replaceDetails, setReplaceDetails] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)

  function exportNow(): void {
    if (data === undefined) return
    const now = new Date()
    const payload = buildExport(data, now)
    const missed: string[] = []
    const products = data.products.length - payload.products.length
    const orders = data.orders.length - payload.orders.length
    if (products > 0) missed.push(plural(products, 'product'))
    if (orders > 0) missed.push(plural(orders, 'order'))
    setExportNote(
      missed.length === 0
        ? null
        : `${listed(missed)} couldn’t be included — too corrupt to read back. They are still on this phone.`,
    )
    // Synchronous, inside the tap.
    share.share([
      {
        name: backupFileName(now),
        text: JSON.stringify(payload, null, 2),
        type: 'application/json',
      },
      {
        // The BOM is what makes Thai product names survive Excel.
        name: ordersCsvFileName(now),
        text: UTF8_BOM + buildOrdersCsv(data.orders, now),
        type: 'text/csv',
      },
    ])
  }

  async function choose(file: File | undefined): Promise<void> {
    setImportError(null)
    setResult(null)
    setPending(null)
    // An export's confirmation must not be left hanging over an import.
    setExportNote(null)
    share.clear()
    if (file === undefined) return
    // Before `text()`: reading a gigabyte into memory is a kill no
    // `try`/`catch` of ours can catch.
    if (file.size > MAX_IMPORT_BYTES) {
      setImportError(TOO_LARGE_MESSAGE)
      return
    }
    setBusy(true)
    try {
      const parsed = parseImport(await file.text())
      if (!parsed.ok) {
        setImportError(parsed.error)
        return
      }
      const summary = await previewImport(parsed.payload, database)
      setReplaceDetails(summary.replaceDetailsByDefault)
      setPending({ fileName: file.name, payload: parsed.payload, summary })
    } catch (thrown) {
      setImportError(message(thrown, "Couldn't read that file"))
    } finally {
      setBusy(false)
    }
  }

  async function apply(): Promise<void> {
    if (pending === null || busy) return
    setBusy(true)
    setImportError(null)
    try {
      const summary = await importBackup(pending.payload, database, { replaceDetails })
      setResult(summary)
      setPending(null)
    } catch (thrown) {
      setImportError(message(thrown, "Couldn't import that file — nothing was changed"))
    } finally {
      setBusy(false)
    }
  }

  function importLabel(summary: ImportSummary): string {
    const parts: string[] = []
    if (summary.newOrders > 0) parts.push(plural(summary.newOrders, 'order'))
    if (summary.newProducts > 0) parts.push(plural(summary.newProducts, 'product'))
    if (replaceDetails && hasDetailChanges(summary)) parts.push('the shop details')
    return parts.length === 0 ? 'Nothing to import' : `Import ${listed(parts)}`
  }

  return (
    <section className="admin-section" aria-label="Backup">
      <h2 className="admin-section-heading">Backup</h2>
      <p className="admin-message muted">
        Everything on this phone as a file you can keep. Nothing is sent anywhere.
      </p>

      <div className="admin-actions">
        <button
          type="button"
          className="admin-primary-button"
          disabled={data === undefined || busy}
          onClick={exportNow}
        >
          Export
        </button>
      </div>
      {share.shared && <p className="admin-message muted">Shared.</p>}
      {exportNote !== null && (
        // An alert, not a muted aside: this is money missing from the file.
        <p className="checkout-error" role="alert">
          {exportNote}
        </p>
      )}
      {share.downloads.length > 0 && (
        <div className="backup-downloads">
          <p className="admin-message muted">Save each file:</p>
          {share.downloads.map((link) => (
            <a key={link.name} className="backup-download" href={link.href} download={link.name}>
              {link.name}
            </a>
          ))}
        </div>
      )}

      <h3 className="backup-subheading">Import</h3>
      <p className="admin-message muted">
        Merges a backup into this phone. Orders already here are never changed, and the PIN is never
        touched.
      </p>
      <label className="admin-field">
        <span className="admin-field-label">Choose a backup file</span>
        <input
          type="file"
          className="backup-file-input"
          accept="application/json,.json"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0]
            // Cleared so choosing the same file twice fires `change` again.
            event.target.value = ''
            void choose(file)
          }}
        />
      </label>

      {importError !== null && (
        <p className="checkout-error" role="alert">
          {importError}
        </p>
      )}

      {pending !== null && (
        <div className="backup-preview" role="group" aria-label="Import this backup?">
          <p className="admin-message">
            {pending.fileName}: {plural(pending.summary.products, 'product')},{' '}
            {plural(pending.summary.orders, 'order')} — {pending.summary.newOrders} new,{' '}
            {pending.summary.existingOrders} already here.
          </p>

          {pending.summary.numberCollisions > 0 && (
            <p className="admin-message">{collisionNote(pending.summary.numberCollisions)}</p>
          )}

          {hasDetailChanges(pending.summary) ? (
            <>
              <label className="backup-option">
                <input
                  type="checkbox"
                  className="backup-checkbox"
                  checked={replaceDetails}
                  disabled={busy}
                  onChange={(event) => setReplaceDetails(event.target.checked)}
                />
                <span>Also replace shop settings and product details</span>
              </label>
              <p className="admin-message muted">
                Orders are merged either way. Leave this off to keep what is on this phone now.
              </p>
              <ul className="backup-changes">
                {pending.summary.settingsChanges.map((change) => (
                  <li key={change.field}>
                    {change.field}: {change.from} → {change.to}
                  </li>
                ))}
                {pending.summary.changedProducts > 0 && (
                  <li>
                    {plural(pending.summary.changedProducts, 'product')} already here would be
                    replaced.
                  </li>
                )}
                {pending.summary.priceChanges.map((change) => (
                  <li key={change.id}>
                    {change.name}: {formatBaht(change.from)} → {formatBaht(change.to)}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="admin-message muted">
              The shop settings and product details on this phone already match the file.
            </p>
          )}

          <div className="admin-actions">
            <button
              type="button"
              className="admin-secondary-button"
              disabled={busy}
              onClick={() => setPending(null)}
            >
              Cancel import
            </button>
            <button
              type="button"
              className="admin-primary-button"
              disabled={busy || importLabel(pending.summary) === 'Nothing to import'}
              onClick={() => void apply()}
            >
              {importLabel(pending.summary)}
            </button>
          </div>
        </div>
      )}

      {result !== null && (
        <div role="status">
          <p className="admin-message">
            Imported {plural(result.newOrders, 'order')} and {plural(result.newProducts, 'product')}
            .
          </p>
          {result.existingOrders > 0 && (
            <p className="admin-message">
              {plural(result.existingOrders, 'order')} already here were left as they are.
            </p>
          )}
          {result.changedProducts > 0 && (
            <p className="admin-message">
              {result.replacedProducts > 0
                ? `${plural(result.replacedProducts, 'product')} already here replaced.`
                : `${plural(result.changedProducts, 'product')} already here left as they are.`}
            </p>
          )}
          {result.settingsChanges.length > 0 && (
            <p className="admin-message">
              {result.settingsApplied
                ? 'Shop settings updated.'
                : 'Shop settings left as they were on this phone.'}
            </p>
          )}
          {result.numberCollisions > 0 && (
            <p className="admin-message">{collisionNote(result.numberCollisions)}</p>
          )}
        </div>
      )}
    </section>
  )
}
