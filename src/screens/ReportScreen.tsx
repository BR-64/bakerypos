import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import './ReportScreen.css'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { db, type PosDatabase } from '../db/db'
import { ordersForDay } from '../db/orders'
import { localDayKey, parseLocalDayKey } from '../domain/day'
import { formatBaht } from '../domain/money'
import { buildZReport, formatZReport } from '../domain/report'
import type { Settings } from '../domain/settings'
import type { Order } from '../domain/types'
import { useShareText } from '../hooks/useShareText'

export interface ReportScreenProps {
  database?: PosDatabase
  /** `null` while the settings read is still in flight — see `ScreenProps`. */
  settings: Settings | null
}

/**
 * The Z report: one local day's takings, picked with a native
 * `<input type="date">` and shareable as plain text.
 *
 * The picker sits *outside* the inner `ErrorBoundary` on purpose. If the
 * body crashes — a corrupt record `buildZReport` somehow renders wrong,
 * a rejected query — choosing another day has to stay possible, and
 * changing the day also remounts the boundary (via `retryKey`) so the
 * new day isn't hidden behind the old day's error.
 */
export function ReportScreen({ database = db, settings }: ReportScreenProps) {
  const [dayKey, setDayKey] = useState(() => localDayKey())
  const [retryKey, setRetryKey] = useState(0)

  return (
    <main className="app screen report-screen">
      <h1 className="report-title">Report</h1>

      <div className="report-day">
        <label className="report-day-label" htmlFor="report-day-input">
          Day
        </label>
        <input
          id="report-day-input"
          className="report-day-input"
          type="date"
          value={dayKey}
          max={localDayKey()}
          onChange={(event) => {
            setDayKey(event.target.value)
            setRetryKey((k) => k + 1)
          }}
        />
      </div>

      <ErrorBoundary key={retryKey} onRetry={() => setRetryKey((k) => k + 1)}>
        <ReportBody
          database={database}
          dayKey={dayKey}
          shopName={settings === null ? null : settings.shopName}
        />
      </ErrorBoundary>
    </main>
  )
}

interface ReportBodyProps {
  database: PosDatabase
  dayKey: string
  shopName: string | null
}

function ReportBody({ database, dayKey, shopName }: ReportBodyProps) {
  // Keyed on the `dayKey` **string**. A `Date` here would be a fresh
  // object on every render, never equal to the previous one, and the query
  // would re-run forever. The Date is built inside the callback instead.
  const orders = useLiveQuery(() => {
    const parsed = parseLocalDayKey(dayKey)
    if (parsed === null) return Promise.resolve<Order[]>([])
    return ordersForDay(database, parsed)
  }, [database, dayKey])

  const share = useShareText()

  const day = parseLocalDayKey(dayKey)
  if (day === null) {
    return <p className="report-message muted">Pick a day.</p>
  }
  if (orders === undefined) {
    return <p className="report-message muted">Loading report…</p>
  }

  const report = buildZReport(orders, day)
  const nothingHappened =
    report.orderCount === 0 && report.voidedCount === 0 && report.invalidCount === 0
  // No shop name yet means the settings read hasn't landed; sharing a
  // report headed by a guessed name isn't worth it for the second it lasts.
  const shareText = shopName === null ? null : formatZReport(report, shopName)

  return (
    <>
      {nothingHappened ? (
        <p className="report-message muted">No sales on this day.</p>
      ) : (
        <>
          <dl className="report-summary">
            <div className="report-summary-row">
              <dt>Orders</dt>
              <dd>{report.orderCount}</dd>
            </div>
            <div className="report-summary-row">
              <dt>Total</dt>
              <dd>{formatBaht(report.total)}</dd>
            </div>
            <div className="report-summary-row">
              <dt>Cash</dt>
              <dd>{formatBaht(report.cashTotal)}</dd>
            </div>
            <div className="report-summary-row">
              <dt>PromptPay</dt>
              <dd>{formatBaht(report.promptPayTotal)}</dd>
            </div>
            <div className="report-summary-row report-summary-drawer">
              <dt>Cash expected in drawer</dt>
              <dd>{formatBaht(report.cashTotal)}</dd>
            </div>
          </dl>

          <h2 className="report-heading">Items</h2>
          {report.products.length === 0 ? (
            <p className="report-message muted">No items sold.</p>
          ) : (
            <ul className="report-products">
              {report.products.map((product) => (
                <li key={product.productId} className="report-product">
                  <span className="report-product-name">{product.name}</span>
                  <span className="report-product-units muted">× {product.units}</span>
                  <span className="report-product-revenue">{formatBaht(product.revenue)}</span>
                </li>
              ))}
            </ul>
          )}

          {report.voidedCount > 0 && (
            <p className="report-voided muted">
              Voided: {report.voidedCount} — {formatBaht(report.voidedTotal)} (excluded)
            </p>
          )}
          {report.invalidCount > 0 && (
            <p className="report-note muted">
              {report.invalidCount} order{report.invalidCount === 1 ? '' : 's'} couldn't be read.
            </p>
          )}
          {report.mismatchedTotalCount > 0 && (
            <p className="report-note muted">
              {report.mismatchedTotalCount} order
              {report.mismatchedTotalCount === 1 ? '' : 's'} with an incomplete item list.
            </p>
          )}
        </>
      )}

      {share.fallbackText !== null && (
        <div className="report-share-fallback">
          <p className="muted">Copy this text by hand:</p>
          {/* `user-select: text` in the CSS — index.css disables selection
              app-wide, which would make this textarea useless. */}
          <textarea
            className="report-share-textarea"
            aria-label="Z report text"
            readOnly
            rows={12}
            value={share.fallbackText}
          />
        </div>
      )}

      <div className="bottom-bar report-bottom-bar">
        {share.copied && <span className="report-share-copied">Copied</span>}
        <button
          type="button"
          className="report-share-button"
          disabled={shareText === null}
          onClick={() => {
            // Synchronous, inside the tap — see `useShareText`.
            if (shareText !== null) share.share(shareText)
          }}
        >
          Share
        </button>
      </div>
    </>
  )
}
