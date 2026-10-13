import { DEFAULT_GST_RATES } from '../types'

export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function lineTax(quantity: number, unitAmount: number, gstRate = 0) {
  const taxableAmount = roundMoney(quantity * unitAmount)
  const gstAmount = roundMoney(taxableAmount * (gstRate / 100))
  return {
    taxableAmount,
    gstAmount,
    lineTotal: roundMoney(taxableAmount + gstAmount),
    gstRate,
  }
}

export function sumTaxLines(lines: Array<{ taxableAmount: number; gstAmount: number }>) {
  const taxableSubtotal = roundMoney(lines.reduce((s, l) => s + l.taxableAmount, 0))
  const gstTotal = roundMoney(lines.reduce((s, l) => s + l.gstAmount, 0))
  return {
    taxableSubtotal,
    gstTotal,
    grandTotal: roundMoney(taxableSubtotal + gstTotal),
  }
}

export function gstLabel(rate?: number): string {
  if (rate == null) return '—'
  return `${rate}%`
}

export const DEFAULT_TARGET_MARGIN_PCT = 30

export function clampTargetMargin(value: unknown, fallback = DEFAULT_TARGET_MARGIN_PCT): number {
  const n = typeof value === 'number' ? value : parseFloat(String(value ?? ''))
  if (!Number.isFinite(n)) return fallback
  return Math.min(99, Math.max(0, Math.round(n * 100) / 100))
}

/** Product override when set; otherwise company default from Settings. */
export function effectiveTargetMargin(
  productMargin: number | null | undefined,
  globalMargin: number | null | undefined,
): number {
  if (productMargin != null && Number.isFinite(productMargin)) {
    return clampTargetMargin(productMargin)
  }
  return clampTargetMargin(globalMargin)
}

/** Margin on selling price: (sell − cost) / sell × 100. Null if sell ≤ 0. */
export function marginPctFromPrices(cost: number, sell: number): number | null {
  if (!Number.isFinite(sell) || sell <= 0) return null
  const c = Number.isFinite(cost) ? cost : 0
  return Math.round(((sell - c) / sell) * 1000) / 10
}

export function suggestedSell(taxableCost: number, marginPct: number, gstRate = 0) {
  const taxableSell = marginPct >= 100 ? taxableCost : taxableCost / (1 - marginPct / 100)
  const gstAmount = roundMoney(taxableSell * (gstRate / 100))
  return {
    taxableSell: roundMoney(taxableSell),
    gstAmount,
    invoiceTotal: roundMoney(taxableSell + gstAmount),
  }
}

/** Normalize GST slab list: unique, sorted, 0–100, always includes 0. */
export function normalizeGstRates(raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : []
  const rates = new Set<number>([0])
  for (const item of list) {
    const n = typeof item === 'number' ? item : parseFloat(String(item))
    if (!Number.isFinite(n)) continue
    const clamped = Math.min(100, Math.max(0, Math.round(n * 100) / 100))
    rates.add(clamped)
  }
  const sorted = [...rates].sort((a, b) => a - b)
  return sorted.length > 0 ? sorted : [...DEFAULT_GST_RATES]
}

/** Fallback when Settings slabs are not loaded yet. */
export const GST_RATE_OPTIONS: number[] = [...DEFAULT_GST_RATES]