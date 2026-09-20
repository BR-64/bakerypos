import type { CartLine, Satang } from './types'

/** Convert a baht amount (e.g. 45 or 45.5) to integer satang. Only for parsing input/seed data. */
export function bahtToSatang(baht: number): Satang {
  return Math.round(baht * 100)
}

/** Format satang as Thai baht for display, e.g. 4550 -> "฿45.50", 4500 -> "฿45". */
export function formatBaht(satang: Satang): string {
  const sign = satang < 0 ? '-' : ''
  const abs = Math.abs(satang)
  const baht = Math.floor(abs / 100)
  const rem = abs % 100
  const bahtStr = baht.toLocaleString('en-US')
  return rem === 0 ? `${sign}฿${bahtStr}` : `${sign}฿${bahtStr}.${String(rem).padStart(2, '0')}`
}

/**
 * Parse a baht amount typed by a human ("45", "45.5", "45.50") into
 * integer satang, or `null` if it isn't one.
 *
 * Unlike `bahtToSatang`, which multiplies a float and rounds, this never
 * does floating-point arithmetic on money at all: the whole-baht and
 * satang halves of the string are parsed as separate integers and combined
 * with `* 100 + …`. That matters because this is the Admin price field —
 * the one place a person types a price that every future sale is then
 * snapshotted from.
 *
 * Rejects (rather than rounding) more than two decimal places, a leading
 * `+`/`-`, spaces inside the number, non-ASCII digits, and anything that
 * would not land on a safe integer.
 */
export function parseBahtInput(input: string): Satang | null {
  if (typeof input !== 'string') return null
  const trimmed = input.trim()
  if (!/^[0-9]{1,9}(\.[0-9]{1,2})?$/.test(trimmed)) return null
  const [bahtPart, satangPart = ''] = trimmed.split('.')
  const satang = Number(satangPart.padEnd(2, '0'))
  const total = Number(bahtPart) * 100 + satang
  return Number.isSafeInteger(total) ? total : null
}

/**
 * Satang as the plain string an Admin price field is pre-filled with:
 * `5500` -> `"55"`, `4550` -> `"45.50"`. No `฿`, no thousands separators —
 * this is an editable value, not a display one (`formatBaht` is that), and
 * it must round-trip through `parseBahtInput` unchanged.
 */
export function formatBahtInput(satang: Satang): string {
  if (!Number.isSafeInteger(satang) || satang < 0) return ''
  const baht = Math.floor(satang / 100)
  const rem = satang % 100
  return rem === 0 ? String(baht) : `${baht}.${String(rem).padStart(2, '0')}`
}

export function lineTotal(line: Pick<CartLine, 'unitPrice' | 'qty'>): Satang {
  return line.unitPrice * line.qty
}

export function cartTotal(lines: Pick<CartLine, 'unitPrice' | 'qty'>[]): Satang {
  return lines.reduce((sum, l) => sum + lineTotal(l), 0)
}

/** Change due for a cash payment. Throws if the customer paid too little. */
export function changeDue(total: Satang, tendered: Satang): Satang {
  if (!Number.isInteger(total) || !Number.isInteger(tendered)) {
    throw new Error('Money must be integer satang')
  }
  if (tendered < total) {
    throw new Error('Insufficient payment')
  }
  return tendered - total
}

/**
 * Suggested quick-tender buttons for a cash total, e.g. total 4500 ->
 * [4500 (exact), 5000, 10000, 50000]. Keeps the checkout to one tap.
 */
export function quickTenderOptions(total: Satang): Satang[] {
  const notes = [2000, 5000, 10000, 50000, 100000] // 20, 50, 100, 500, 1000 baht
  const options = new Set<Satang>([total])
  for (const n of notes) {
    if (n > total) options.add(n)
  }
  return [...options].sort((a, b) => a - b).slice(0, 4)
}
