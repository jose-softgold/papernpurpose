import { GST_RATES } from '../types'

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

export function suggestedSell(taxableCost: number, marginPct: number, gstRate = 0) {
  const taxableSell = marginPct >= 100 ? taxableCost : taxableCost / (1 - marginPct / 100)
  const gstAmount = roundMoney(taxableSell * (gstRate / 100))
  return {
    taxableSell: roundMoney(taxableSell),
    gstAmount,
    invoiceTotal: roundMoney(taxableSell + gstAmount),
  }
}

export const GST_RATE_OPTIONS = GST_RATES
