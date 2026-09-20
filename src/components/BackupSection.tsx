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
  UTF8_BOM,
  type BackupPayload,
} from '../domain/backup'
import { safeString } from '../domain/log'
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
 * choose the file, read the summary, *then* apply it.
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
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [busy, setBusy] = useState(false)

  function exportNow(): void {
    if (data === undefined) return
    const now = new Date()
    const payload = buildExport(data, now)
    const skipped =
      data.products.length - payload.products.length + (data.orders.length - payload.orders.length)
    setExportNote(
      skipped > 0
        ? `${plural(skipped, 'record')} couldn’t be included — they’re too corrupt to read back.`
        : null,
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
    if (file === undefined) return
    setBusy(true)
    try {
      const parsed = parseImport(await file.text())
      if (!parsed.ok) {
        setImportError(parsed.error)
        return
      }
      setPending({
        fileName: file.name,
        payload: parsed.payload,
        summary: await previewImport(parsed.payload, database),
      })
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
      const summary = await importBackup(pending.payload, database)
      setResult(summary)
      setPending(null)
    } catch (thrown) {
      setImportError(message(thrown, "Couldn't import that file — nothing was changed"))
    } finally {
      setBusy(false)
    }
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
        <p className="admin-message muted" role="status">
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
              disabled={busy}
              onClick={() => void apply()}
            >
              Import {pending.summary.newOrders} new
            </button>
          </div>
        </div>
      )}

      {result !== null && (
        <p className="admin-message" role="status">
          Imported {plural(result.newOrders, 'order')} and {plural(result.products, 'product')}.{' '}
          {result.existingOrders} order{result.existingOrders === 1 ? ' was' : 's were'} already
          here and stayed as they were.
        </p>
      )}
    </section>
  )
}
