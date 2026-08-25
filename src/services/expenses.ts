import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config'
import {
  BankTransaction,
  BUSINESS_EXPENSE_BUCKET_LABELS,
  BUSINESS_EXPENSE_BUCKETS,
  BusinessExpenseBucket,
  ExpenseBudgetRow,
  ExpenseBudgetsDoc,
  ExpenseSectionTotals,
} from '../types'
import { bankService } from './bank'

const BUDGETS_DOC = 'expenseBudgets'

function inDateRange(tx: BankTransaction, from: string, to: string): boolean {
  if (!from && !to) return true
  const t = tx.occurredAt?.toMillis?.() ?? null
  if (t == null) return false
  const fromMs = from ? new Date(from).getTime() : null
  const toMs = to ? new Date(to + 'T23:59:59').getTime() : null
  if (fromMs != null && t < fromMs) return false
  if (toMs != null && t > toMs) return false
  return true
}

function categoryKey(tx: BankTransaction): string {
  return (tx.category || tx.personalCategory || 'other').trim().toLowerCase()
}

export const expenseService = {
  async getBudgets(): Promise<ExpenseBudgetsDoc> {
    const snap = await getDoc(doc(db, 'meta', BUDGETS_DOC))
    if (!snap.exists()) return { personal: {}, business: {} }
    const data = snap.data()
    return {
      personal: (data.personal as Record<string, number>) ?? {},
      business: (data.business as Record<string, number>) ?? {},
    }
  },

  async saveBudgets(personal: Record<string, number>, business: Record<string, number>): Promise<void> {
    const cleanPersonal: Record<string, number> = {}
    for (const [k, v] of Object.entries(personal)) {
      const key = k.trim().toLowerCase()
      if (key && Number(v) >= 0) cleanPersonal[key] = Number(v)
    }
    const cleanBusiness: Record<string, number> = {}
    for (const [k, v] of Object.entries(business)) {
      if (Number(v) >= 0) cleanBusiness[k] = Number(v)
    }
    await setDoc(
      doc(db, 'meta', BUDGETS_DOC),
      { personal: cleanPersonal, business: cleanBusiness, updatedAt: serverTimestamp() },
      { merge: true },
    )
  },

  summarizePersonal(txs: BankTransaction[], from: string, to: string) {
    const byCategory: Record<string, { spent: number; credits: number }> = {}
    let totalSpent = 0
    let totalCredits = 0
    for (const tx of txs) {
      if (bankService.booksOf(tx) !== 'personal') continue
      if (tx.status === 'ignored') continue
      if (!inDateRange(tx, from, to)) continue
      const cat = categoryKey(tx)
      if (!byCategory[cat]) byCategory[cat] = { spent: 0, credits: 0 }
      if (tx.direction === 'debit') {
        byCategory[cat].spent += tx.amount
        totalSpent += tx.amount
      } else {
        byCategory[cat].credits += tx.amount
        totalCredits += tx.amount
      }
    }
    return { byCategory, totalSpent, totalCredits }
  },

  summarizeBusiness(txs: BankTransaction[], from: string, to: string) {
    const byBucket: Record<string, { spent: number; credits: number }> = {}
    let totalSpent = 0
    let totalCredits = 0
    for (const tx of txs) {
      if (bankService.booksOf(tx) !== 'business') continue
      if (tx.status === 'ignored') continue
      if (!inDateRange(tx, from, to)) continue
      const bucket = bankService.reasonKind(tx)
      if (!byBucket[bucket]) byBucket[bucket] = { spent: 0, credits: 0 }
      if (tx.direction === 'debit') {
        byBucket[bucket].spent += tx.amount
        totalSpent += tx.amount
      } else {
        byBucket[bucket].credits += tx.amount
        totalCredits += tx.amount
      }
    }
    return { byBucket, totalSpent, totalCredits }
  },

  buildPersonalRows(
    spentMap: Record<string, { spent: number; credits: number }>,
    budgetMap: Record<string, number>,
  ): ExpenseBudgetRow[] {
    const keys = new Set([...Object.keys(spentMap), ...Object.keys(budgetMap)])
    const rows: ExpenseBudgetRow[] = []
    for (const key of keys) {
      const spent = spentMap[key]?.spent ?? 0
      const credits = spentMap[key]?.credits ?? 0
      const budget = budgetMap[key] ?? 0
      const remaining = budget - spent
      const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0
      rows.push({
        key,
        label: key.charAt(0).toUpperCase() + key.slice(1),
        spent,
        budget,
        remaining,
        pct,
        overBudget: budget > 0 && spent > budget,
        credits,
      })
    }
    return rows.sort((a, b) => {
      if (b.spent !== a.spent) return b.spent - a.spent
      return a.label.localeCompare(b.label)
    })
  },

  buildBusinessRows(
    spentMap: Record<string, { spent: number; credits: number }>,
    budgetMap: Record<string, number>,
  ): ExpenseBudgetRow[] {
    const rows: ExpenseBudgetRow[] = []
    for (const key of BUSINESS_EXPENSE_BUCKETS) {
      const spent = spentMap[key]?.spent ?? 0
      const credits = spentMap[key]?.credits ?? 0
      const budget = budgetMap[key] ?? 0
      const remaining = budget - spent
      const pct = budget > 0 ? Math.min(100, (spent / budget) * 100) : spent > 0 ? 100 : 0
      rows.push({
        key,
        label: BUSINESS_EXPENSE_BUCKET_LABELS[key as BusinessExpenseBucket],
        spent,
        budget,
        remaining,
        pct,
        overBudget: budget > 0 && spent > budget,
        credits,
      })
    }
    return rows
  },

  totalsFromRows(rows: ExpenseBudgetRow[], totalCredits = 0): ExpenseSectionTotals {
    const totalBudget = rows.reduce((s, r) => s + r.budget, 0)
    const totalSpent = rows.reduce((s, r) => s + r.spent, 0)
    const remaining = totalBudget - totalSpent
    return {
      totalBudget,
      totalSpent,
      remaining,
      overBy: remaining < 0 ? -remaining : 0,
      totalCredits,
    }
  },
}
