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
