import { Timestamp } from 'firebase/firestore'

/** Rupee amounts with up to 2 decimals (hides trailing .00). */
export function formatCurrency(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`
}

export function formatDate(ts: Timestamp | null | undefined): string {
  if (!ts) return '—'
  const d = ts.toDate()
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
  const date = `${String(d.getDate()).padStart(2,'0')}-${months[d.getMonth()]}-${d.getFullYear()}`
  const h = d.getHours()
  const m = String(d.getMinutes()).padStart(2,'0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${date} ${h12}:${m} ${ampm}`
}

export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity} ${unit}`
}

export function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`
}

export function timestampToDatetimeLocal(ts: Timestamp | null | undefined): string {
  if (!ts?.toDate) return ''
  const d = ts.toDate()
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
