import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  BUSINESS_EXPENSE_BUCKETS,
  BUSINESS_EXPENSE_BUCKET_LABELS,
  BankTransaction,
  BusinessExpenseBucket,
  ExpenseBudgetRow,
} from '../../types'
import { bankService } from '../../services/bank'
import { expenseService } from '../../services/expenses'
import { formatCurrency } from '../../utils/format'
import { datePreset } from '../../utils/datePresets'
import { useAuth } from '../../hooks/useAuth'
import { canWriteMaster } from '../../utils/roles'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import PageHeader from '../../components/PageHeader'
import LoadingSpinner from '../../components/LoadingSpinner'
import StatCard from '../../components/StatCard'
import SectionCard from '../../components/SectionCard'

type Tab = 'personal' | 'business'

function progressTone(pct: number, overBudget: boolean): 'ok' | 'warn' | 'over' {
  if (overBudget) return 'over'
  if (pct >= 80) return 'warn'
  return 'ok'
}

function bankLink(
  tab: Tab,
  row: ExpenseBudgetRow,
  dateFrom: string,
  dateTo: string,
): string {
  const params = new URLSearchParams()
  params.set('books', tab)
  if (dateFrom) params.set('from', dateFrom)
  if (dateTo) params.set('to', dateTo)
  if (tab === 'business') {
    params.set('reason', row.key)
  } else {
    params.set('search', row.key)
  }
  return `/bank?${params.toString()}`
}

function BudgetRow({
  row,
  tab,
  dateFrom,
  dateTo,
}: {
  row: ExpenseBudgetRow
  tab: Tab
  dateFrom: string
  dateTo: string
}) {
  const tone = progressTone(row.pct, row.overBudget)
  const barPct = row.budget > 0 ? Math.min(100, row.pct) : row.spent > 0 ? 100 : 0

  return (
    <Link
      to={bankLink(tab, row, dateFrom, dateTo)}
      className="pc-budget-row text-decoration-none text-body d-block"
    >
      <div className="d-flex justify-content-between align-items-start gap-2 mb-1">
        <div>
          <div className="fw-semibold">{row.label}</div>
          <div className="small text-muted">
            {formatCurrency(row.spent)}
            {row.budget > 0 ? ` of ${formatCurrency(row.budget)}` : ' spent'}
            {row.credits > 0 ? ` · +${formatCurrency(row.credits)} in` : ''}
          </div>
        </div>
        <div className="text-end small">
          {row.budget > 0 ? (
            row.overBudget ? (
              <span className="text-danger fw-semibold">Over {formatCurrency(-row.remaining)}</span>
            ) : (
              <span className="text-success">{formatCurrency(row.remaining)} left</span>
            )
          ) : (
            <span className="text-muted">No budget set</span>
          )}
        </div>
      </div>
      {row.budget > 0 && (
        <div className="pc-budget-bar">
          <div
            className={`pc-budget-bar-fill tone-${tone}`}
            style={{ width: `${barPct}%` }}
            role="progressbar"
            aria-valuenow={Math.round(row.pct)}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
    </Link>
  )
}

export default function ExpensePage() {
  const { role } = useAuth()
  const canEdit = canWriteMaster(role)
  const { toasts, showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [txs, setTxs] = useState<BankTransaction[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [budgets, setBudgets] = useState<{ personal: Record<string, number>; business: Record<string, number> }>({
    personal: {},
    business: {},
  })
  const [tab, setTab] = useState<Tab>('personal')
  const [dateFrom, setDateFrom] = useState(() => datePreset('this_month').from)
  const [dateTo, setDateTo] = useState(() => datePreset('this_month').to)
  const [budgetOpen, setBudgetOpen] = useState(false)
  const [draftPersonal, setDraftPersonal] = useState<Record<string, string>>({})
  const [draftBusiness, setDraftBusiness] = useState<Record<string, string>>({})
  const [newCategory, setNewCategory] = useState('')

  async function reload() {
    const [rows, cats, b] = await Promise.all([
      bankService.getAll({ max: 500 }),
      bankService.getCategories(),
      expenseService.getBudgets(),
    ])
    setTxs(rows)
    setCategories(cats)
    setBudgets(b)
  }

  useEffect(() => {
    reload()
      .catch(err => {
        console.error(err)
        showToast('Failed to load expenses', 'danger')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const personalSummary = useMemo(
    () => expenseService.summarizePersonal(txs, dateFrom, dateTo),
    [txs, dateFrom, dateTo],
  )
  const businessSummary = useMemo(
    () => expenseService.summarizeBusiness(txs, dateFrom, dateTo),
    [txs, dateFrom, dateTo],
  )

  const personalRows = useMemo(
    () => expenseService.buildPersonalRows(personalSummary.byCategory, budgets.personal),
    [personalSummary.byCategory, budgets.personal],
  )
  const businessRows = useMemo(
    () => expenseService.buildBusinessRows(businessSummary.byBucket, budgets.business),
    [businessSummary.byBucket, budgets.business],
  )

  const activeRows = tab === 'personal' ? personalRows : businessRows
  const activeTotals = useMemo(() => {
    const credits = tab === 'personal' ? personalSummary.totalCredits : businessSummary.totalCredits
    return expenseService.totalsFromRows(activeRows, credits)
  }, [tab, activeRows, personalSummary.totalCredits, businessSummary.totalCredits])

  const filterScopeLabel = useMemo(() => {
    if (dateFrom && dateTo) return `${dateFrom} → ${dateTo}`
    if (dateFrom) return `from ${dateFrom}`
    if (dateTo) return `until ${dateTo}`
    return 'all dates'
  }, [dateFrom, dateTo])

  function openBudgetModal() {
    const p: Record<string, string> = {}
    const keys = new Set([...Object.keys(budgets.personal), ...personalRows.map(r => r.key)])
    for (const k of keys) p[k] = budgets.personal[k] != null ? String(budgets.personal[k]) : ''
    const b: Record<string, string> = {}
    for (const k of BUSINESS_EXPENSE_BUCKETS) {
      b[k] = budgets.business[k] != null ? String(budgets.business[k]) : ''
    }
    setDraftPersonal(p)
    setDraftBusiness(b)
    setNewCategory('')
    setBudgetOpen(true)
  }

  async function saveBudgets() {
    if (!canEdit) return
    setSaving(true)
    try {
      const personal: Record<string, number> = {}
      for (const [k, v] of Object.entries(draftPersonal)) {
        if (!String(v).trim()) continue
        const n = Number(v)
        if (k.trim() && !Number.isNaN(n) && n >= 0) personal[k.trim().toLowerCase()] = n
      }
      const business: Record<string, number> = {}
      for (const [k, v] of Object.entries(draftBusiness)) {
        if (!String(v).trim()) continue
        const n = Number(v)
        if (!Number.isNaN(n) && n >= 0) business[k] = n
      }
      await expenseService.saveBudgets(personal, business)
      setBudgets({ personal, business })
      setBudgetOpen(false)
      showToast('Budgets saved', 'success')
    } catch (err) {
      console.error(err)
      showToast(err instanceof Error ? err.message : 'Save failed', 'danger')
    } finally {
      setSaving(false)
    }
  }

  function addPersonalBudgetLine() {
    const cat = newCategory.trim().toLowerCase()
    if (!cat) {
      showToast('Enter a category name', 'warning')
      return
    }
    setDraftPersonal(prev => ({ ...prev, [cat]: prev[cat] ?? '' }))
    setNewCategory('')
  }

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <ToastContainer toasts={toasts} />
      <PageHeader
        title="Expense tracker"
        subtitle="Monthly budgets vs bank spend — personal and business"
        icon="💰"
        actions={
          canEdit ? (
            <button type="button" className="btn btn-sm btn-outline-primary" onClick={openBudgetModal}>
              Manage budgets
            </button>
          ) : undefined
        }
      />

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <div className="small text-muted">
          Period: <strong>{filterScopeLabel}</strong>
        </div>
        <Link to="/bank" className="btn btn-sm btn-outline-secondary">
          Open Bank
        </Link>
      </div>

      <div className="d-flex flex-wrap gap-1 mb-2">
        {(
          [
            ['this_month', 'This month'],
            ['last_month', 'Last month'],
            ['last_7', 'Last 7 days'],
            ['last_30', 'Last 30 days'],
            ['all', 'All dates'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={() => {
              const r = datePreset(key)
              setDateFrom(r.from)
              setDateTo(r.to)
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="row g-2 align-items-end mb-3">
        <div className="col-6 col-md-3">
          <label className="form-label small mb-0">From</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div className="col-6 col-md-3">
          <label className="form-label small mb-0">To</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
      </div>

      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link text-nowrap${tab === 'personal' ? ' active' : ''}`}
            onClick={() => setTab('personal')}
          >
            Personal
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link text-nowrap${tab === 'business' ? ' active' : ''}`}
            onClick={() => setTab('business')}
          >
            Business
          </button>
        </li>
      </ul>

      <div className="row g-2 g-md-3 mb-3">
        <div className="col-6 col-lg-3">
          <StatCard label="Total budget" value={formatCurrency(activeTotals.totalBudget)} icon="🎯" tone="violet" />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Spent"
            value={formatCurrency(activeTotals.totalSpent)}
            icon="💸"
            tone="coral"
            alert={activeTotals.totalSpent > activeTotals.totalBudget && activeTotals.totalBudget > 0}
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label="Remaining"
            value={formatCurrency(Math.max(0, activeTotals.remaining))}
            icon="✅"
            tone="teal"
          />
        </div>
        <div className="col-6 col-lg-3">
          <StatCard
            label={activeTotals.overBy > 0 ? 'Over budget' : 'Income (credits)'}
            value={
              activeTotals.overBy > 0
                ? formatCurrency(activeTotals.overBy)
                : formatCurrency(activeTotals.totalCredits)
            }
            icon={activeTotals.overBy > 0 ? '⚠️' : '📥'}
            tone={activeTotals.overBy > 0 ? 'amber' : 'slate'}
            alert={activeTotals.overBy > 0}
          />
        </div>
      </div>

      <SectionCard
        title={tab === 'personal' ? 'Personal categories' : 'Business buckets'}
        subtitle="Tap a row to view matching bank transactions"
        icon={tab === 'personal' ? '👤' : '🏢'}
        flush
      >
        {activeRows.length === 0 ? (
          <div className="p-3 text-muted small">
            No {tab} spend in this period. Tag bank transactions on the{' '}
            <Link to="/bank">Bank</Link> page, then set budgets here.
          </div>
        ) : (
          <div className="list-group list-group-flush">
            {activeRows.map(row => (
              <div key={row.key} className="list-group-item">
                <BudgetRow row={row} tab={tab} dateFrom={dateFrom} dateTo={dateTo} />
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {budgetOpen && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Manage budgets</h5>
                  <button type="button" className="btn-close" onClick={() => setBudgetOpen(false)} />
                </div>
                <div className="modal-body">
                  <p className="small text-muted">
                    Monthly budget amounts (INR). Spend is calculated from bank transactions in the
                    selected period.
                  </p>

                  <h6 className="mt-3">Personal categories</h6>
                  <div className="d-flex flex-wrap gap-1 mb-2">
                    {categories.slice(0, 12).map(c => (
                      <button
                        key={c}
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() =>
                          setDraftPersonal(prev => ({ ...prev, [c]: prev[c] ?? '' }))
                        }
                      >
                        + {c}
                      </button>
                    ))}
                  </div>
                  <div className="input-group input-group-sm mb-3">
                    <input
                      className="form-control"
                      placeholder="New category"
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && addPersonalBudgetLine()}
                    />
                    <button type="button" className="btn btn-outline-secondary" onClick={addPersonalBudgetLine}>
                      Add
                    </button>
                  </div>
                  {Object.keys(draftPersonal).length === 0 ? (
                    <p className="small text-muted">Add a category to set a personal budget.</p>
                  ) : (
                    Object.entries(draftPersonal)
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, val]) => (
                        <div key={key} className="row g-2 align-items-center mb-2">
                          <div className="col-sm-4">
                            <span className="text-capitalize">{key}</span>
                          </div>
                          <div className="col-sm-8">
                            <div className="input-group input-group-sm">
                              <input
                                type="number"
                                min={0}
                                step={1}
                                className="form-control"
                                placeholder="Monthly budget ₹"
                                value={val}
                                onChange={e =>
                                  setDraftPersonal(prev => ({ ...prev, [key]: e.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn btn-outline-danger"
                                onClick={() =>
                                  setDraftPersonal(prev => {
                                    const next = { ...prev }
                                    delete next[key]
                                    return next
                                  })
                                }
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                        </div>
                      ))
                  )}

                  <h6 className="mt-4">Business buckets</h6>
                  {BUSINESS_EXPENSE_BUCKETS.map(key => (
                    <div key={key} className="row g-2 align-items-center mb-2">
                      <div className="col-sm-4">{BUSINESS_EXPENSE_BUCKET_LABELS[key as BusinessExpenseBucket]}</div>
                      <div className="col-sm-8">
                        <div className="input-group input-group-sm">
                          <input
                            type="number"
                            min={0}
                            step={1}
                            className="form-control"
                            placeholder="Monthly budget ₹"
                            value={draftBusiness[key] ?? ''}
                            onChange={e =>
                              setDraftBusiness(prev => ({ ...prev, [key]: e.target.value }))
                            }
                          />
                          <button
                            type="button"
                            className="btn btn-outline-danger"
                            disabled={!draftBusiness[key]}
                            onClick={() => setDraftBusiness(prev => ({ ...prev, [key]: '' }))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setBudgetOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={saving}
                    onClick={() => void saveBudgets()}
                  >
                    {saving ? 'Saving…' : 'Save budgets'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
