import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  BankBooks,
  BankPaymentKind,
  BankTagReason,
  BankTransaction,
  BankTxStatus,
  Customer,
  Order,
  Purchase,
  Supplier,
  WorkerAdvanceBalance,
  WorkerOption,
} from '../../types'
import { bankService } from '../../services/bank'
import { advancesService } from '../../services/advances'
import { orderService } from '../../services/orders'
import { purchaseService } from '../../services/purchases'
import { customerService } from '../../services/customers'
import { supplierService } from '../../services/suppliers'
import { usersService } from '../../services/users'
import { formatCurrency, formatDate } from '../../utils/format'
import { exportToCSV, exportToExcel } from '../../utils/export'
import { useAuth } from '../../hooks/useAuth'
import { canWriteMaster } from '../../utils/roles'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import PageHeader from '../../components/PageHeader'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import DataGrid from '../../components/DataGrid'
import StatCard from '../../components/StatCard'
import SectionCard from '../../components/SectionCard'
import { callGmailBackfill } from '../../firebase/functions'
import { datePreset } from '../../utils/datePresets'

type BooksFilter = 'all' | BankBooks
type DirectionFilter = 'all' | 'credit' | 'debit'
type StatusFilter = 'all' | BankTxStatus
type ReasonFilter = 'all' | 'customer' | 'logistics' | 'recce' | 'salary' | 'worker' | 'purchase' | 'other'
type CashMark = '' | Exclude<BankTagReason, 'ignore'>

const EVERYDAY_CATEGORIES = ['food', 'tea', 'transport', 'supplies'] as const

function localDateTimeInput(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function emptyCashForm() {
  return {
    occurredAt: localDateTimeInput(),
    amount: '',
    direction: 'debit' as 'credit' | 'debit',
    note: '',
    mark: '' as CashMark,
    orderId: '',
    purchaseId: '',
    workerId: '',
    paymentKind: 'advance' as BankPaymentKind,
    workerPayKind: 'out' as 'out' | 'spend',
    logisticsCompany: '',
    category: '',
    customCategory: '',
    markCompleted: false,
  }
}

function readBooksFilter(raw: string | null): BooksFilter {
  if (raw === 'personal' || raw === 'business' || raw === 'unassigned') return raw
  return 'all'
}

function readReasonFilter(raw: string | null): ReasonFilter {
  if (
    raw === 'customer' ||
    raw === 'logistics' ||
    raw === 'recce' ||
    raw === 'salary' ||
    raw === 'worker' ||
    raw === 'purchase' ||
    raw === 'other'
  ) {
    return raw
  }
  return 'all'
}

export default function BankPage() {
  const [searchParams] = useSearchParams()
  const { role } = useAuth()
  const canEdit = canWriteMaster(role)
  const { toasts, showToast } = useToast()

  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [txs, setTxs] = useState<BankTransaction[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [workers, setWorkers] = useState<WorkerOption[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [advanceBalances, setAdvanceBalances] = useState<WorkerAdvanceBalance[]>([])

  const [booksFilter, setBooksFilter] = useState<BooksFilter>(() =>
    readBooksFilter(searchParams.get('books')),
  )
  const [directionFilter, setDirectionFilter] = useState<DirectionFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [reasonFilter, setReasonFilter] = useState<ReasonFilter>(() =>
    readReasonFilter(searchParams.get('reason')),
  )
  const [search, setSearch] = useState(() => searchParams.get('search') || '')
  const [dateFrom, setDateFrom] = useState(() => searchParams.get('from') || '')
  const [dateTo, setDateTo] = useState(() => searchParams.get('to') || '')

  const [syncOpen, setSyncOpen] = useState(false)
  const [syncDays, setSyncDays] = useState(7)

  const [personalFor, setPersonalFor] = useState<BankTransaction | null>(null)
  const [pickCategory, setPickCategory] = useState('other')
  const [customCategory, setCustomCategory] = useState('')
  const [tagsFor, setTagsFor] = useState<BankTransaction | null>(null)
  const [tagsDraft, setTagsDraft] = useState('')

  const [tagFor, setTagFor] = useState<BankTransaction | null>(null)
  const [tagReason, setTagReason] = useState<BankTagReason>('customer_payment')
  const [tagOrderId, setTagOrderId] = useState('')
  const [tagPurchaseId, setTagPurchaseId] = useState('')
  const [tagWorkerId, setTagWorkerId] = useState('')
  const [tagPaymentKind, setTagPaymentKind] = useState<BankPaymentKind>('advance')
  const [tagWorkerPayKind, setTagWorkerPayKind] = useState<'out' | 'spend'>('out')
  const [tagLogisticsCompany, setTagLogisticsCompany] = useState('')
  const [tagCategory, setTagCategory] = useState('')
  const [tagCustomCategory, setTagCustomCategory] = useState('')
  const [tagMarkCompleted, setTagMarkCompleted] = useState(false)
  const [cashOpen, setCashOpen] = useState(false)
  const [cashForm, setCashForm] = useState(emptyCashForm)

  const [editTx, setEditTx] = useState<{
    tx: BankTransaction
    occurredAt: string
    amount: string
    direction: 'credit' | 'debit'
    description: string
    counterparty: string
  } | null>(null)
  const [deleteTx, setDeleteTx] = useState<BankTransaction | null>(null)

  const [categoriesOpen, setCategoriesOpen] = useState(false)
  const [newCategory, setNewCategory] = useState('')
  const [bankTab, setBankTab] = useState<'transactions' | 'float'>('transactions')

  async function reload() {
    const [rows, ords, purs, cats, custs, sups, wrks, advanceEntries] = await Promise.all([
      bankService.getAll({ max: 500 }),
      orderService.getAll().catch(() => [] as Order[]),
      purchaseService.getAll().catch(() => [] as Purchase[]),
      bankService.getCategories(),
      customerService.getAll().catch(() => [] as Customer[]),
      supplierService.getAll().catch(() => [] as Supplier[]),
      usersService.listWorkers().catch(() => [] as WorkerOption[]),
      advancesService.listEntries().catch(() => []),
    ])
    setTxs(rows)
    setOrders(ords)
    setPurchases(purs)
    setCategories(cats)
    setCustomers(custs)
    setSuppliers(sups)
    setWorkers(wrks)
    setAdvanceBalances(advancesService.balances(advanceEntries))
  }

  useEffect(() => {
    reload()
      .catch(err => {
        console.error(err)
        showToast('Failed to load bank transactions', 'danger')
      })
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const customerMap = useMemo(() => {
    const m: Record<string, string> = {}
    customers.forEach(c => {
      m[c.id] = c.name
    })
    return m
  }, [customers])

  const supplierMap = useMemo(() => {
    const m: Record<string, string> = {}
    suppliers.forEach(s => {
      m[s.id] = s.name
    })
    return m
  }, [suppliers])

  const workerMap = useMemo(() => {
    const m: Record<string, string> = {}
    workers.forEach(w => {
      m[w.id] = w.name
    })
    return m
  }, [workers])

  const filtered = useMemo(() => {
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : null
    const toMs = dateTo ? new Date(dateTo + 'T23:59:59').getTime() : null
    return txs.filter(tx => {
      const books = bankService.booksOf(tx)
      if (booksFilter !== 'all' && books !== booksFilter) return false
      if (directionFilter !== 'all' && tx.direction !== directionFilter) return false
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false
      if (reasonFilter !== 'all' && bankService.reasonKind(tx) !== reasonFilter) return false
      if (fromMs != null || toMs != null) {
        const t = tx.occurredAt?.toMillis?.() ?? null
        if (t == null) return false
        if (fromMs != null && t < fromMs) return false
        if (toMs != null && t > toMs) return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = [
          tx.description,
          tx.counterparty,
          tx.bankName,
          tx.rawSubject,
          tx.category,
          tx.personalCategory,
          tx.paymentKind,
          tx.expenseKind,
          tx.workerPayKind,
          tx.mark,
          tx.workerId ? workerMap[tx.workerId] : null,
          ...(tx.tags ?? []),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [txs, booksFilter, directionFilter, statusFilter, reasonFilter, dateFrom, dateTo, search, workerMap])

  const dash = useMemo(() => bankService.dashboardSnapshot(filtered), [filtered])

  useEffect(() => {
    const books = readBooksFilter(searchParams.get('books'))
    const reason = readReasonFilter(searchParams.get('reason'))
    const q = searchParams.get('search') || ''
    const from = searchParams.get('from') || ''
    const to = searchParams.get('to') || ''
    setBooksFilter(books)
    setReasonFilter(reason)
    setSearch(q)
    setDateFrom(from)
    setDateTo(to)
  }, [searchParams])

  const filterScopeLabel = useMemo(() => {
    if (dateFrom && dateTo) return `${dateFrom} → ${dateTo}`
    if (dateFrom) return `from ${dateFrom}`
    if (dateTo) return `until ${dateTo}`
    return 'all dates'
  }, [dateFrom, dateTo])

  type DashFilterKind =
    | 'pending'
    | 'untagged'
    | 'business_in'
    | 'business_out'
    | 'personal'
    | 'customer'
    | 'logistics'
    | 'recce'

  function applyDashboardFilter(kind: DashFilterKind) {
    setBankTab('transactions')
    const month = datePreset('this_month')
    setDateFrom(month.from)
    setDateTo(month.to)
    setSearch('')
    setDirectionFilter('all')
    setReasonFilter('all')
    setBooksFilter('all')
    setStatusFilter('all')

    if (kind === 'pending') {
      setDateFrom('')
      setDateTo('')
      setStatusFilter('pending')
    } else if (kind === 'untagged') {
      setDateFrom('')
      setDateTo('')
      setBooksFilter('unassigned')
      setStatusFilter('all')
    } else if (kind === 'business_in') {
      setBooksFilter('business')
      setDirectionFilter('credit')
    } else if (kind === 'business_out') {
      setBooksFilter('business')
      setDirectionFilter('debit')
    } else if (kind === 'personal') {
      setBooksFilter('personal')
    } else if (kind === 'customer') {
      setBooksFilter('business')
      setDirectionFilter('credit')
      setReasonFilter('customer')
    } else if (kind === 'logistics') {
      setBooksFilter('business')
      setDirectionFilter('debit')
      setReasonFilter('logistics')
    } else if (kind === 'recce') {
      setBooksFilter('business')
      setReasonFilter('recce')
    }
  }

  async function run(id: string, fn: () => Promise<void>, okMsg: string) {
    if (!canEdit) return
    setBusyId(id)
    try {
      await fn()
      await reload()
      showToast(okMsg, 'success')
    } catch (err) {
      console.error(err)
      showToast(err instanceof Error ? err.message : 'Action failed', 'danger')
    } finally {
      setBusyId(null)
    }
  }

  async function runBackfill() {
    if (!canEdit) return
    const days = Math.min(90, Math.max(1, Math.round(Number(syncDays) || 7)))
    setSyncDays(days)
    setBusyId('sync')
    try {
      const result = await callGmailBackfill(days)
      setSyncOpen(false)
      await reload()
      showToast(
        `Backfill: ${result.processed} processed, ${result.written} written, ${result.skippedDuplicates} skipped duplicates`,
        'success',
      )
    } catch (err) {
      console.error(err)
      showToast('Sync failed — connect Gmail in Settings if needed', 'danger')
    } finally {
      setBusyId(null)
    }
  }

  function openTagModal(tx: BankTransaction) {
    const books = bankService.booksOf(tx)
    let defaultReason: BankTagReason = 'other'
    if (tx.mark === 'salary' || tx.workerPayKind === 'payout') defaultReason = 'salary'
    else if (tx.mark === 'customer_payment' || tx.paymentKind) defaultReason = 'customer_payment'
    else if (tx.mark === 'logistics' || tx.expenseKind === 'logistics') defaultReason = 'logistics'
    else if (tx.mark === 'recce' || tx.expenseKind === 'recce') defaultReason = 'recce'
    else if (tx.mark === 'purchase' || tx.purchaseId || tx.matchType === 'purchase') defaultReason = 'purchase'
    else if (tx.mark === 'other') defaultReason = 'other'
    else if (tx.workerPayKind === 'out' || tx.workerPayKind === 'spend' || tx.workerId) defaultReason = 'worker'
    else if (books === 'unassigned') defaultReason = 'other'
    else if (tx.direction === 'credit') defaultReason = 'customer_payment'
    else defaultReason = 'other'

    setTagFor(tx)
    setTagReason(defaultReason)
    setTagOrderId(tx.orderId || (tx.matchType === 'order' ? tx.matchId || '' : ''))
    setTagPurchaseId(tx.purchaseId || (tx.matchType === 'purchase' ? tx.matchId || '' : ''))
    setTagWorkerId(tx.workerId || '')
    setTagPaymentKind(tx.paymentKind || 'advance')
    setTagWorkerPayKind(tx.workerPayKind === 'spend' ? 'spend' : 'out')
    setTagLogisticsCompany('')
    setTagCategory(tx.category || tx.personalCategory || '')
    setTagCustomCategory('')
    setTagMarkCompleted(false)
  }

  function openEditTx(tx: BankTransaction) {
    const d = tx.occurredAt?.toDate?.() ?? new Date()
    const local = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
    setEditTx({
      tx,
      occurredAt: local,
      amount: String(tx.amount),
      direction: tx.direction,
      description: tx.description ?? '',
      counterparty: tx.counterparty ?? '',
    })
  }

  async function saveEditTx(e: React.FormEvent) {
    e.preventDefault()
    if (!editTx) return
    const amount = parseFloat(editTx.amount)
    const occurredAt = new Date(editTx.occurredAt)
    if (!(amount > 0)) {
      showToast('Enter an amount greater than 0', 'warning')
      return
    }
    if (Number.isNaN(occurredAt.getTime())) {
      showToast('Enter a valid date', 'warning')
      return
    }
    const { tx, direction, description, counterparty } = editTx
    setEditTx(null)
    await run(
      tx.id,
      () => bankService.updateDetails(tx.id, { occurredAt, amount, direction, description, counterparty }),
      'Transaction updated',
    )
  }

  async function confirmDeleteTx() {
    if (!deleteTx) return
    const id = deleteTx.id
    setDeleteTx(null)
    await run(id, () => bankService.delete(id), 'Transaction deleted')
  }

  /** After classify, drop filters that would hide the updated row. */
  function clearHidingFilters() {
    if (statusFilter === 'pending') setStatusFilter('all')
    if (booksFilter === 'unassigned') setBooksFilter('all')
  }

  function saveTag() {
    if (!tagFor || !canEdit) return
    const id = tagFor.id
    const cat = (tagCustomCategory.trim() || tagCategory).toLowerCase() || null
    const worker = workers.find(w => w.id === tagWorkerId)

    if (tagReason === 'worker' && !tagWorkerId) {
      showToast('Pick a worker for float', 'warning')
      return
    }

    const linked =
      ((tagReason === 'customer_payment' || tagReason === 'logistics' || tagReason === 'salary') &&
        !!tagOrderId) ||
      (tagReason === 'purchase' && !!tagPurchaseId) ||
      (tagReason === 'recce' && !!tagWorkerId)
    const expectedStatus = tagReason === 'ignore' ? 'ignored' : linked ? 'matched' : 'reviewed'

    setTagFor(null)
    clearHidingFilters()
    void run(
      id,
      () =>
        bankService.tagBusiness(id, {
          reason: tagReason,
          paymentKind: tagPaymentKind,
          orderId: tagOrderId || null,
          purchaseId: tagPurchaseId || null,
          workerId: tagWorkerId || null,
          workerName: worker?.name,
          workerPayKind: tagReason === 'worker' ? (tagWorkerPayKind === 'spend' ? 'spend' : 'out') : 'payout',
          logisticsCompany: tagLogisticsCompany,
          category: cat,
          markOrderCompleted: tagMarkCompleted && !!tagOrderId,
        }),
      tagReason === 'ignore' ? 'Ignored' : `Marked · ${expectedStatus}`,
    )
  }

  function openCashForm() {
    setCashForm(emptyCashForm())
    setCashOpen(true)
  }

  async function saveCash() {
    if (!canEdit) return
    const amount = parseFloat(cashForm.amount)
    const occurredAt = new Date(cashForm.occurredAt)
    if (!(amount > 0)) {
      showToast('Enter an amount greater than 0', 'warning')
      return
    }
    if (Number.isNaN(occurredAt.getTime())) {
      showToast('Enter a valid date', 'warning')
      return
    }
    if (cashForm.mark === 'worker' && !cashForm.workerId) {
      showToast('Pick a worker for float', 'warning')
      return
    }
    const mark = cashForm.mark
    const cat = (cashForm.customCategory.trim() || cashForm.category).toLowerCase() || null
    const worker = workers.find(w => w.id === cashForm.workerId)
    const linked =
      ((mark === 'customer_payment' || mark === 'logistics' || mark === 'salary') && !!cashForm.orderId) ||
      (mark === 'purchase' && !!cashForm.purchaseId) ||
      (mark === 'recce' && !!cashForm.workerId)
    setCashOpen(false)
    clearHidingFilters()
    await run(
      'cash',
      async () => {
        const id = await bankService.createCashEntry({
          amount,
          direction: cashForm.direction,
          occurredAt,
          note: cashForm.note,
        })
        if (mark) {
          await bankService.tagBusiness(id, {
            reason: mark,
            paymentKind: cashForm.paymentKind,
            orderId: cashForm.orderId || null,
            purchaseId: cashForm.purchaseId || null,
            workerId: cashForm.workerId || null,
            workerName: worker?.name,
            workerPayKind: mark === 'worker' ? cashForm.workerPayKind : 'payout',
            logisticsCompany: cashForm.logisticsCompany,
            category: cat,
            markOrderCompleted: cashForm.markCompleted && !!cashForm.orderId,
          })
        }
      },
      mark ? `Cash recorded · ${linked ? 'matched' : 'marked'}` : 'Cash recorded',
    )
  }

  async function addCategory() {
    const cat = newCategory.trim().toLowerCase()
    if (!cat) {
      showToast('Enter a category name', 'warning')
      return
    }
    setBusyId('category')
    try {
      await bankService.rememberCategory(cat)
      const cats = await bankService.getCategories()
      setCategories(cats)
      setNewCategory('')
      showToast(`Category “${cat}” saved`, 'success')
    } catch (err) {
      console.error(err)
      showToast(err instanceof Error ? err.message : 'Failed to save category', 'danger')
    } finally {
      setBusyId(null)
    }
  }

  function orderLabel(o: Order) {
    const name = customerMap[o.customerId] || 'Customer'
    return `${name} · ${o.status} · ${formatCurrency(o.grandTotal ?? o.total)}`
  }

  function purchaseLabel(p: Purchase) {
    const name = supplierMap[p.supplierId] || 'Supplier'
    return `${name} · ${formatCurrency(p.grandTotal ?? p.total)}`
  }

  function tagSummary(tx: BankTransaction) {
    const parts: string[] = []
    if (tx.mark === 'salary' || tx.workerPayKind === 'payout') parts.push('Salary')
    else if (tx.mark === 'other') parts.push('Other')
    else if (tx.mark) parts.push(tx.mark.replace('_', ' '))
    if (tx.paymentKind) parts.push(`Payment: ${tx.paymentKind}`)
    if (tx.expenseKind) parts.push(tx.expenseKind)
    if (tx.workerPayKind && tx.workerPayKind !== 'payout') parts.push(`Float: ${tx.workerPayKind}`)
    const cat = tx.category || tx.personalCategory
    if (cat) parts.push(cat)
    if (tx.workerId) parts.push(workerMap[tx.workerId] || tx.workerId.slice(0, 6))
    if (tx.orderId) {
      const o = orders.find(x => x.id === tx.orderId)
      parts.push(o ? `Order: ${orderLabel(o)}` : `Order ${tx.orderId.slice(0, 6)}`)
    }
    if (tx.purchaseId) {
      const p = purchases.find(x => x.id === tx.purchaseId)
      parts.push(p ? `Purchase: ${purchaseLabel(p)}` : `Purchase ${tx.purchaseId.slice(0, 6)}`)
    }
    return parts
  }

  function exportRows(format: 'csv' | 'xlsx') {
    const rows = filtered.map(tx => ({
      date: tx.occurredAt?.toDate?.()?.toISOString().slice(0, 10) || '',
      amount: tx.amount,
      direction: tx.direction,
      books: bankService.booksOf(tx),
      category: tx.category || tx.personalCategory || '',
      paymentKind: tx.paymentKind || '',
      expenseKind: tx.expenseKind || '',
      description: tx.description || tx.rawSubject || '',
      counterparty: tx.counterparty || '',
      bank: tx.bankName || '',
      accountLast4: tx.accountLast4 || '',
      status: tx.status,
      worker: tx.workerId ? workerMap[tx.workerId] || tx.workerId : '',
      orderId: tx.orderId || '',
      purchaseId: tx.purchaseId || '',
      tags: (tx.tags || []).join('; '),
      source: tx.source,
    }))
    if (!rows.length) {
      showToast('Nothing to export for current filters', 'warning')
      return
    }
    const name = `bank-export-${new Date().toISOString().slice(0, 10)}`
    if (format === 'csv') exportToCSV(rows, name)
    else exportToExcel(rows, name)
    showToast(`Exported ${rows.length} row(s)`, 'success')
  }

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <ToastContainer toasts={toasts} />
      <PageHeader
        title="Ledger"
        subtitle="Bank alerts and cash in one list. Mark a line now — order, worker, or bill can wait."
        icon="🏦"
        actions={
          canEdit ? (
            <div className="d-flex flex-wrap gap-1">
              <button type="button" className="btn btn-sm btn-primary" onClick={openCashForm}>
                Record cash
              </button>
              <Link to="/import?type=worker-spends" className="btn btn-sm btn-outline-secondary">
                Import
              </Link>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => exportRows('csv')}
              >
                Export CSV
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => exportRows('xlsx')}
              >
                Export Excel
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary"
                onClick={() => {
                  setCategoriesOpen(true)
                  setNewCategory('')
                }}
              >
                Categories
              </button>
              <button
                type="button"
                className="btn btn-sm btn-outline-primary"
                disabled={busyId === 'sync'}
                onClick={() => {
                  setSyncDays(7)
                  setSyncOpen(true)
                }}
              >
                Sync…
              </button>
            </div>
          ) : undefined
        }
      />

      <div className="d-flex flex-wrap justify-content-between align-items-center gap-2 mb-2">
        <div className="small text-muted">
          Totals for <strong>{filterScopeLabel}</strong>
          {booksFilter !== 'all' ? ` · ${booksFilter}` : ''}
          {directionFilter !== 'all' ? ` · ${directionFilter}` : ''}
          {statusFilter !== 'all' ? ` · ${statusFilter}` : ''}
          {reasonFilter !== 'all' ? ` · ${reasonFilter}` : ''}
          {' · '}
          {filtered.length} tx
        </div>
        <Link to="/reports?tab=bank" className="btn btn-sm btn-outline-secondary">
          Full report
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
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0">From</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
          />
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0">To</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
          />
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0">Books</label>
          <select
            className="form-select form-select-sm"
            value={booksFilter}
            onChange={e => setBooksFilter(e.target.value as BooksFilter)}
          >
            <option value="all">All</option>
            <option value="unassigned">Unassigned</option>
            <option value="business">Business</option>
            <option value="personal">Personal</option>
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0">Direction</label>
          <select
            className="form-select form-select-sm"
            value={directionFilter}
            onChange={e => setDirectionFilter(e.target.value as DirectionFilter)}
          >
            <option value="all">All</option>
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0">Status</label>
          <select
            className="form-select form-select-sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as StatusFilter)}
          >
            <option value="all">All</option>
            <option value="pending">Pending</option>
            <option value="reviewed">Reviewed</option>
            <option value="matched">Matched</option>
            <option value="ignored">Ignored</option>
          </select>
        </div>
        <div className="col-6 col-md-2">
          <label className="form-label small mb-0">Reason</label>
          <select
            className="form-select form-select-sm"
            value={reasonFilter}
            onChange={e => setReasonFilter(e.target.value as ReasonFilter)}
          >
            <option value="all">All</option>
            <option value="customer">Customer payment</option>
            <option value="logistics">Logistics</option>
            <option value="recce">Recce</option>
            <option value="salary">Salary</option>
            <option value="worker">Worker float</option>
            <option value="purchase">Purchase</option>
            <option value="other">Other / untagged</option>
          </select>
        </div>
        <div className="col-12 col-md-4">
          <label className="form-label small mb-0">Search</label>
          <input
            className="form-control form-control-sm"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Description, bank, category…"
          />
        </div>
      </div>

      <div className="row g-2 g-md-3 mb-3">
        {(
          [
            {
              kind: 'pending' as const,
              label: 'Pending review',
              value: dash.pendingReview,
              icon: '⏳',
              tone: 'amber' as const,
              alert: dash.pendingReview > 0,
            },
            {
              kind: 'untagged' as const,
              label: 'Untagged',
              value: dash.untagged,
              icon: '🏷️',
              tone: 'slate' as const,
              alert: dash.untagged > 0,
            },
            {
              kind: 'business_in' as const,
              label: 'Business in',
              value: formatCurrency(dash.totals.businessIn),
              icon: '📥',
              tone: 'teal' as const,
            },
            {
              kind: 'business_out' as const,
              label: 'Business out',
              value: formatCurrency(dash.totals.businessOut),
              icon: '📤',
              tone: 'coral' as const,
            },
            {
              kind: 'personal' as const,
              label: 'Personal net',
              value: formatCurrency(dash.totals.personalNet),
              icon: '👤',
              tone: 'purpose' as const,
            },
            {
              kind: 'customer' as const,
              label: 'Customer payments',
              value: formatCurrency(dash.totals.customerPayments),
              icon: '💳',
              tone: 'teal' as const,
            },
            {
              kind: 'logistics' as const,
              label: 'Logistics',
              value: formatCurrency(dash.totals.logistics),
              icon: '🚚',
              tone: 'amber' as const,
            },
            {
              kind: 'recce' as const,
              label: 'Recce',
              value: formatCurrency(dash.totals.recce),
              icon: '🧭',
              tone: 'slate' as const,
            },
          ] as const
        ).map(card => (
          <div key={card.kind} className="col-6 col-lg-3">
            <button
              type="button"
              className="btn p-0 border-0 bg-transparent w-100 text-start"
              onClick={() => applyDashboardFilter(card.kind)}
              title="Apply this filter"
            >
              <StatCard
                label={card.label}
                value={card.value}
                icon={card.icon}
                tone={card.tone}
                alert={'alert' in card ? card.alert : false}
              />
            </button>
          </div>
        ))}
      </div>

      <ul className="nav nav-tabs mb-3 flex-nowrap overflow-auto">
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link text-nowrap${bankTab === 'transactions' ? ' active' : ''}`}
            onClick={() => setBankTab('transactions')}
          >
            Transactions
          </button>
        </li>
        <li className="nav-item">
          <button
            type="button"
            className={`nav-link text-nowrap${bankTab === 'float' ? ' active' : ''}`}
            onClick={() => setBankTab('float')}
          >
            Worker float
            {advanceBalances.length > 0 ? (
              <span className="badge text-bg-secondary ms-2">{advanceBalances.length}</span>
            ) : null}
          </button>
        </li>
      </ul>

      {bankTab === 'float' && (
        <SectionCard title="Worker float" subtitle="Advances remaining" icon="👷" flush>
          {advanceBalances.length === 0 ? (
            <div className="p-3 text-muted small">
              No worker advances yet. Tag a bank debit as Worker → Float out to start a balance.
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover mb-0">
                <thead>
                  <tr>
                    <th>Worker</th>
                    <th className="text-end">Sent</th>
                    <th className="text-end">Spent</th>
                    <th className="text-end">Remaining</th>
                  </tr>
                </thead>
                <tbody>
                  {advanceBalances.map(b => (
                    <tr key={b.workerId}>
                      <td>{b.workerName}</td>
                      <td className="text-end">{formatCurrency(b.sent)}</td>
                      <td className="text-end">{formatCurrency(b.spent)}</td>
                      <td className="text-end fw-semibold">{formatCurrency(b.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {bankTab === 'transactions' && (
        <>
      <p className="small text-muted mb-2">
        <Link to="/expenses">Expense tracker</Link> — personal &amp; business budgets vs spend.
        {' · '}
        Record cash for money that never hit the bank. Staff meals and similar spends: money out, mark <strong>Other</strong>, category <strong>food</strong> — not Salary and not Purchase. Use <strong>Mark…</strong> on a bank debit the same way. Connect inbox under{' '}
        <Link to="/settings">Settings</Link>.
      </p>

      <DataGrid
        items={filtered}
        resetKey={`${booksFilter}-${directionFilter}-${statusFilter}-${reasonFilter}-${dateFrom}-${dateTo}-${search}`}
        empty={
          <EmptyState
            message="No ledger lines"
            description="Record cash, connect Gmail in Settings and sync, or loosen filters."
          />
        }
      >
        {pageItems => (
          <>
            <thead>
              <tr>
                <th>When</th>
                <th>Amount</th>
                <th>Details</th>
                <th className="d-none d-md-table-cell">Books</th>
                <th>Status</th>
                {canEdit && <th style={{ minWidth: 140 }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {pageItems.map(tx => {
                const books = bankService.booksOf(tx)
                const busy = busyId === tx.id
                const links = tagSummary(tx)
                return (
                  <tr key={tx.id}>
                    <td className="small text-nowrap">{formatDate(tx.occurredAt)}</td>
                    <td className="text-nowrap">
                      <span className={tx.direction === 'credit' ? 'text-success' : 'text-danger'}>
                        {tx.direction === 'credit' ? '+' : '−'}
                        {formatCurrency(tx.amount)}
                      </span>
                      <div className="small text-muted">{tx.direction}</div>
                      <div className="d-md-none mt-1">
                        <span
                          className={`badge ${
                            books === 'personal'
                              ? 'text-bg-info'
                              : books === 'business'
                                ? 'text-bg-primary'
                                : 'text-bg-secondary'
                          }`}
                        >
                          {books}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="fw-semibold">
                        {tx.description || tx.rawSubject || '—'}{' '}
                        <span className={`badge ${tx.source === 'manual' ? 'text-bg-warning' : 'text-bg-light border'}`}>
                          {tx.source === 'manual' ? 'Cash' : 'Bank'}
                        </span>
                      </div>
                      <div className="small text-muted">
                        {[tx.bankName, tx.accountLast4 ? `••••${tx.accountLast4}` : null, tx.counterparty]
                          .filter(Boolean)
                          .join(' · ') || tx.snippet}
                      </div>
                      {links.length > 0 && (
                        <div className="small text-primary mt-1">{links.join(' · ')}</div>
                      )}
                      {tx.parseConfidence < 0.5 && (
                        <div className="small text-warning">Low parse confidence — verify amount</div>
                      )}
                    </td>
                    <td className="d-none d-md-table-cell">
                      <span
                        className={`badge ${
                          books === 'personal'
                            ? 'text-bg-info'
                            : books === 'business'
                              ? 'text-bg-primary'
                              : 'text-bg-secondary'
                        }`}
                      >
                        {books}
                      </span>
                      {(tx.category || tx.personalCategory) && (
                        <div className="small mt-1">{tx.category || tx.personalCategory}</div>
                      )}
                      {tx.workerId && (
                        <div className="small text-muted mt-1">
                          {workerMap[tx.workerId] || tx.workerId.slice(0, 6)}
                        </div>
                      )}
                      {(tx.tags?.length ?? 0) > 0 && (
                        <div className="small text-muted mt-1">{tx.tags!.join(', ')}</div>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          tx.status === 'matched'
                            ? 'text-bg-success'
                            : tx.status === 'reviewed'
                              ? 'text-bg-info'
                              : tx.status === 'ignored'
                                ? 'text-bg-dark'
                                : 'text-bg-warning'
                        }`}
                      >
                        {tx.status}
                      </span>
                    </td>
                    {canEdit && (
                      <td>
                        <div className="d-flex flex-wrap gap-1">
                          {books !== 'personal' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-info"
                              disabled={busy}
                              onClick={() => {
                                setPersonalFor(tx)
                                setPickCategory(tx.personalCategory || tx.category || categories[0] || 'other')
                                setCustomCategory('')
                              }}
                            >
                              Personal
                            </button>
                          )}
                          {books === 'personal' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              disabled={busy}
                              onClick={() => {
                                setPersonalFor(tx)
                                setPickCategory(tx.personalCategory || tx.category || 'other')
                                setCustomCategory('')
                              }}
                            >
                              Category
                            </button>
                          )}
                          {tx.status !== 'ignored' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-primary"
                              disabled={busy}
                              onClick={() => openTagModal(tx)}
                            >
                              Mark…
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-secondary"
                            disabled={busy}
                            onClick={() => {
                              setTagsFor(tx)
                              setTagsDraft((tx.tags ?? []).join(', '))
                            }}
                          >
                            Labels
                          </button>
                          {tx.status !== 'ignored' &&
                            (tx.status === 'matched' ||
                              tx.mark ||
                              tx.paymentKind ||
                              tx.expenseKind ||
                              tx.workerPayKind) && (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              disabled={busy}
                              onClick={() => void run(tx.id, () => bankService.unmatch(tx.id), 'Cleared mark')}
                            >
                              Clear mark
                            </button>
                          )}
                          {tx.status !== 'ignored' ? (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-dark"
                              disabled={busy}
                              onClick={() => {
                                clearHidingFilters()
                                void run(tx.id, () => bankService.ignore(tx.id), 'Ignored')
                              }}
                            >
                              Ignore
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn btn-sm btn-outline-secondary"
                              disabled={busy}
                              onClick={() => void run(tx.id, () => bankService.unignore(tx.id), 'Restored')}
                            >
                              Restore
                            </button>
                          )}
                          {books !== 'unassigned' && (
                            <button
                              type="button"
                              className="btn btn-sm btn-link p-0 small"
                              disabled={busy}
                              onClick={() =>
                                void run(
                                  tx.id,
                                  () => bankService.setBooks(tx.id, 'unassigned'),
                                  'Cleared books',
                                )
                              }
                            >
                              Clear
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-primary"
                            disabled={busy}
                            onClick={() => openEditTx(tx)}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-outline-danger"
                            disabled={busy}
                            onClick={() => setDeleteTx(tx)}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </>
        )}
      </DataGrid>
        </>
      )}

      {editTx && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <form className="modal-content" onSubmit={e => void saveEditTx(e)}>
                <div className="modal-header">
                  <h5 className="modal-title">Edit transaction</h5>
                  <button type="button" className="btn-close" onClick={() => setEditTx(null)} />
                </div>
                <div className="modal-body">
                  <div className="row g-2">
                    <div className="col-md-6">
                      <label className="form-label">Date</label>
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={editTx.occurredAt}
                        onChange={e => setEditTx(prev => prev && { ...prev, occurredAt: e.target.value })}
                        required
                      />
                    </div>
                    <div className="col-6 col-md-3">
                      <label className="form-label">Amount (₹)</label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="form-control"
                        value={editTx.amount}
                        onChange={e => setEditTx(prev => prev && { ...prev, amount: e.target.value })}
                        required
                      />
                    </div>
                    <div className="col-6 col-md-3">
                      <label className="form-label">Direction</label>
                      <select
                        className="form-select"
                        value={editTx.direction}
                        onChange={e => setEditTx(prev => prev && { ...prev, direction: e.target.value === 'credit' ? 'credit' : 'debit' })}
                      >
                        <option value="debit">Debit (out)</option>
                        <option value="credit">Credit (in)</option>
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label">Counterparty</label>
                      <input
                        className="form-control"
                        value={editTx.counterparty}
                        onChange={e => setEditTx(prev => prev && { ...prev, counterparty: e.target.value })}
                      />
                    </div>
                    <div className="col-12">
                      <label className="form-label">Description</label>
                      <input
                        className="form-control"
                        value={editTx.description}
                        onChange={e => setEditTx(prev => prev && { ...prev, description: e.target.value })}
                      />
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setEditTx(null)}>Cancel</button>
                  <button type="submit" className="btn btn-primary">Save changes</button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

      {deleteTx && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Delete transaction</h5>
                  <button type="button" className="btn-close" onClick={() => setDeleteTx(null)} />
                </div>
                <div className="modal-body">
                  <p className="mb-2">
                    Delete the {formatCurrency(deleteTx.amount)} {deleteTx.direction} on {formatDate(deleteTx.occurredAt)}?
                  </p>
                  {(deleteTx.source === 'alert' || deleteTx.source === 'statement') && (
                    <p className="small text-muted mb-0">
                      This came from a bank email. A later Gmail sync can bring it back; use Ignore if you just want it out of your totals.
                    </p>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setDeleteTx(null)}>Cancel</button>
                  <button type="button" className="btn btn-danger" onClick={() => void confirmDeleteTx()}>Delete</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {syncOpen && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Sync bank emails</h5>
                  <button type="button" className="btn-close" onClick={() => setSyncOpen(false)} />
                </div>
                <div className="modal-body">
                  <label className="form-label">Days to backfill</label>
                  <input
                    type="number"
                    className="form-control"
                    min={1}
                    max={90}
                    value={syncDays}
                    onChange={e => setSyncDays(Number(e.target.value))}
                  />
                  <div className="form-text">1–90 days (default 7). Scans Gmail for bank alerts.</div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setSyncOpen(false)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={busyId === 'sync'}
                    onClick={() => void runBackfill()}
                  >
                    {busyId === 'sync' ? 'Syncing…' : 'Run sync'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {categoriesOpen && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Categories</h5>
                  <button type="button" className="btn-close" onClick={() => setCategoriesOpen(false)} />
                </div>
                <div className="modal-body">
                  <div className="d-flex flex-wrap gap-1 mb-3">
                    {categories.length === 0 ? (
                      <span className="text-muted small">No categories yet</span>
                    ) : (
                      categories.map(c => (
                        <span key={c} className="badge text-bg-light border">
                          {c}
                        </span>
                      ))
                    )}
                  </div>
                  <label className="form-label">Add category</label>
                  <div className="input-group">
                    <input
                      className="form-control"
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value)}
                      placeholder="e.g. packaging"
                      onKeyDown={e => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          void addCategory()
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      disabled={busyId === 'category'}
                      onClick={() => void addCategory()}
                    >
                      Add
                    </button>
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setCategoriesOpen(false)}>
                    Close
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {cashOpen && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog modal-lg modal-dialog-scrollable">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Record cash</h5>
                  <button type="button" className="btn-close" onClick={() => setCashOpen(false)} />
                </div>
                <div className="modal-body">
                  <p className="small text-muted">
                    Use this when the money never arrived as a bank alert. Staff meals: money out, note
                    “food for employees”, then <strong>Other</strong> and <strong>food</strong>. That is not
                    salary and not a supplier purchase.
                  </p>
                  <div className="row g-2">
                    <div className="col-md-4">
                      <label className="form-label">Date</label>
                      <input
                        type="datetime-local"
                        className="form-control"
                        value={cashForm.occurredAt}
                        onChange={e => setCashForm(f => ({ ...f, occurredAt: e.target.value }))}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Amount (₹)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        className="form-control"
                        value={cashForm.amount}
                        onChange={e => setCashForm(f => ({ ...f, amount: e.target.value }))}
                      />
                    </div>
                    <div className="col-md-4">
                      <label className="form-label">Direction</label>
                      <select
                        className="form-select"
                        value={cashForm.direction}
                        onChange={e =>
                          setCashForm(f => ({ ...f, direction: e.target.value as 'credit' | 'debit' }))
                        }
                      >
                        <option value="debit">Money out</option>
                        <option value="credit">Money in</option>
                      </select>
                    </div>
                    <div className="col-12">
                      <label className="form-label">Note</label>
                      <input
                        className="form-control"
                        placeholder="e.g. food for employees"
                        value={cashForm.note}
                        onChange={e => setCashForm(f => ({ ...f, note: e.target.value }))}
                      />
                    </div>
                  </div>

                  <label className="form-label mt-3">Mark</label>
                  <select
                    className="form-select mb-2"
                    value={cashForm.mark}
                    onChange={e =>
                      setCashForm(f => ({ ...f, mark: e.target.value as CashMark }))
                    }
                  >
                    <option value="">Mark later</option>
                    <option value="other">Other everyday spend (food, tea, supplies)</option>
                    <option value="salary">Salary</option>
                    <option value="customer_payment">Customer payment</option>
                    <option value="purchase">Supplier purchase</option>
                    <option value="logistics">Logistics / courier</option>
                    <option value="worker">Worker float</option>
                    <option value="recce">Recce / site visit</option>
                  </select>
                  <p className="small text-muted">
                    Leave the order, worker, or bill blank if you do not know it yet.
                  </p>

                  <div className="mb-2">
                    <div className="form-label">Everyday category</div>
                    <div className="d-flex flex-wrap gap-1 mb-2">
                      {EVERYDAY_CATEGORIES.map(c => (
                        <button
                          key={c}
                          type="button"
                          className={`btn btn-sm ${
                            cashForm.category === c && !cashForm.customCategory.trim()
                              ? 'btn-primary'
                              : 'btn-outline-secondary'
                          }`}
                          onClick={() =>
                            setCashForm(f => ({
                              ...f,
                              mark: 'other',
                              category: c,
                              customCategory: '',
                            }))
                          }
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                    <div className="d-flex flex-wrap gap-1 mb-2">
                      {categories
                        .filter(c => !EVERYDAY_CATEGORIES.includes(c as (typeof EVERYDAY_CATEGORIES)[number]))
                        .slice(0, 24)
                        .map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`btn btn-sm ${
                              cashForm.category === c && !cashForm.customCategory.trim()
                                ? 'btn-primary'
                                : 'btn-outline-secondary'
                            }`}
                            onClick={() =>
                              setCashForm(f => ({ ...f, category: c, customCategory: '' }))
                            }
                          >
                            {c}
                          </button>
                        ))}
                    </div>
                    <input
                      className="form-control"
                      placeholder="Or a new category"
                      value={cashForm.customCategory}
                      onChange={e => setCashForm(f => ({ ...f, customCategory: e.target.value }))}
                    />
                  </div>

                  {(cashForm.mark === 'customer_payment' ||
                    cashForm.mark === 'logistics' ||
                    cashForm.mark === 'salary') && (
                    <>
                      <label className="form-label">
                        {cashForm.mark === 'salary' ? 'Order (optional)' : 'Order (optional, add later)'}
                      </label>
                      <select
                        className="form-select mb-2"
                        value={cashForm.orderId}
                        onChange={e => setCashForm(f => ({ ...f, orderId: e.target.value }))}
                      >
                        <option value="">—</option>
                        {orders
                          .filter(o => o.status !== 'CANCELLED')
                          .slice(0, 80)
                          .map(o => (
                            <option key={o.id} value={o.id}>
                              {orderLabel(o)}
                            </option>
                          ))}
                      </select>
                    </>
                  )}
                  {cashForm.mark === 'customer_payment' && (
                    <select
                      className="form-select mb-2"
                      value={cashForm.paymentKind}
                      onChange={e =>
                        setCashForm(f => ({ ...f, paymentKind: e.target.value as BankPaymentKind }))
                      }
                    >
                      <option value="advance">Advance / deposit</option>
                      <option value="final">Final / balance</option>
                    </select>
                  )}
                  {cashForm.mark === 'purchase' && (
                    <>
                      <p className="small text-muted">Supplier bill only. Staff meals stay on Other → food.</p>
                      <label className="form-label">Purchase (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={cashForm.purchaseId}
                        onChange={e => setCashForm(f => ({ ...f, purchaseId: e.target.value }))}
                      >
                        <option value="">—</option>
                        {purchases.slice(0, 80).map(p => (
                          <option key={p.id} value={p.id}>
                            {purchaseLabel(p)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {(cashForm.mark === 'salary' || cashForm.mark === 'worker' || cashForm.mark === 'recce') && (
                    <>
                      <label className="form-label">
                        Worker {cashForm.mark === 'worker' ? '' : '(optional)'}
                      </label>
                      <select
                        className="form-select mb-2"
                        value={cashForm.workerId}
                        onChange={e => setCashForm(f => ({ ...f, workerId: e.target.value }))}
                      >
                        <option value="">—</option>
                        {workers.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}
                  {cashForm.mark === 'worker' && (
                    <select
                      className="form-select mb-2"
                      value={cashForm.workerPayKind}
                      onChange={e =>
                        setCashForm(f => ({
                          ...f,
                          workerPayKind: e.target.value === 'spend' ? 'spend' : 'out',
                        }))
                      }
                    >
                      <option value="out">Float out (money to worker)</option>
                      <option value="spend">Float spend</option>
                    </select>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setCashOpen(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={() => void saveCash()}>
                    Save cash
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {tagFor && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog modal-lg">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Mark transaction</h5>
                  <button type="button" className="btn-close" onClick={() => setTagFor(null)} />
                </div>
                <div className="modal-body">
                  <p className="small text-muted mb-3">
                    {formatCurrency(tagFor.amount)} · {tagFor.direction} ·{' '}
                    {tagFor.description || tagFor.rawSubject}
                  </p>

                  <label className="form-label">What is this?</label>
                  <select
                    className="form-select mb-2"
                    value={tagReason}
                    onChange={e => setTagReason(e.target.value as BankTagReason)}
                  >
                    <option value="customer_payment">Customer payment</option>
                    <option value="logistics">Logistics / courier</option>
                    <option value="salary">Salary</option>
                    <option value="worker">Worker float</option>
                    <option value="recce">Recce / site visit</option>
                    <option value="purchase">Supplier purchase</option>
                    <option value="other">Other everyday spend (food, tea, supplies)</option>
                    <option value="ignore">Ignore</option>
                  </select>
                  <p className="small text-muted">
                    Food for employees and similar costs: choose <strong>Other</strong>, then <strong>food</strong>.
                    Do not use Salary or Supplier purchase. Links below are optional.
                  </p>

                  {tagReason === 'customer_payment' && (
                    <>
                      <label className="form-label">Order (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={tagOrderId}
                        onChange={e => setTagOrderId(e.target.value)}
                      >
                        <option value="">Add later</option>
                        {orders
                          .filter(o => o.status !== 'CANCELLED')
                          .slice(0, 80)
                          .map(o => (
                            <option key={o.id} value={o.id}>
                              {orderLabel(o)}
                            </option>
                          ))}
                      </select>
                      <label className="form-label">Payment kind</label>
                      <select
                        className="form-select mb-2"
                        value={tagPaymentKind}
                        onChange={e => setTagPaymentKind(e.target.value as BankPaymentKind)}
                      >
                        <option value="advance">Advance / deposit</option>
                        <option value="final">Final / balance</option>
                      </select>
                      {tagOrderId && (
                        <div className="form-check mb-2">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id="tagMarkCompleted"
                            checked={tagMarkCompleted}
                            onChange={e => setTagMarkCompleted(e.target.checked)}
                          />
                          <label className="form-check-label" htmlFor="tagMarkCompleted">
                            Mark order COMPLETED
                          </label>
                        </div>
                      )}
                    </>
                  )}

                  {tagReason === 'logistics' && (
                    <>
                      <label className="form-label">Order (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={tagOrderId}
                        onChange={e => setTagOrderId(e.target.value)}
                      >
                        <option value="">Add later</option>
                        {orders
                          .filter(o => o.status !== 'CANCELLED')
                          .slice(0, 80)
                          .map(o => (
                            <option key={o.id} value={o.id}>
                              {orderLabel(o)}
                            </option>
                          ))}
                      </select>
                      <label className="form-label">Logistics company (optional)</label>
                      <input
                        className="form-control mb-2"
                        value={tagLogisticsCompany}
                        onChange={e => setTagLogisticsCompany(e.target.value)}
                        placeholder="e.g. Blue Dart"
                      />
                    </>
                  )}

                  {tagReason === 'salary' && (
                    <>
                      <p className="small text-muted">Pay for a person. Not for staff meals — use Other → food.</p>
                      <label className="form-label">Worker (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={tagWorkerId}
                        onChange={e => setTagWorkerId(e.target.value)}
                      >
                        <option value="">Add later</option>
                        {workers.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      <label className="form-label">Order (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={tagOrderId}
                        onChange={e => setTagOrderId(e.target.value)}
                      >
                        <option value="">—</option>
                        {orders
                          .filter(o => o.status !== 'CANCELLED')
                          .slice(0, 80)
                          .map(o => (
                            <option key={o.id} value={o.id}>
                              {orderLabel(o)}
                            </option>
                          ))}
                      </select>
                    </>
                  )}

                  {tagReason === 'worker' && (
                    <>
                      <p className="small text-muted">Money handed to a worker to spend. A worker is required.</p>
                      <label className="form-label">Worker</label>
                      <select
                        className="form-select mb-2"
                        value={tagWorkerId}
                        onChange={e => setTagWorkerId(e.target.value)}
                      >
                        <option value="">Select worker…</option>
                        {workers.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                      <label className="form-label">Kind</label>
                      <select
                        className="form-select mb-2"
                        value={tagWorkerPayKind}
                        onChange={e =>
                          setTagWorkerPayKind(e.target.value === 'spend' ? 'spend' : 'out')
                        }
                      >
                        <option value="out">Float out (money to worker)</option>
                        <option value="spend">Float spend</option>
                      </select>
                    </>
                  )}

                  {tagReason === 'recce' && (
                    <>
                      <p className="small text-muted">No order needed. Optionally debit a worker’s float.</p>
                      <label className="form-label">Paid from worker float (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={tagWorkerId}
                        onChange={e => setTagWorkerId(e.target.value)}
                      >
                        <option value="">— none —</option>
                        {workers.map(w => (
                          <option key={w.id} value={w.id}>
                            {w.name}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {tagReason === 'purchase' && (
                    <>
                      <p className="small text-muted">
                        A supplier bill. Staff meals are not a purchase — use Other and food.
                      </p>
                      <label className="form-label">Purchase (optional)</label>
                      <select
                        className="form-select mb-2"
                        value={tagPurchaseId}
                        onChange={e => setTagPurchaseId(e.target.value)}
                      >
                        <option value="">Add later</option>
                        {purchases.slice(0, 80).map(p => (
                          <option key={p.id} value={p.id}>
                            {purchaseLabel(p)}
                          </option>
                        ))}
                      </select>
                    </>
                  )}

                  {tagReason === 'other' && (
                    <div className="mb-2">
                      <label className="form-label">Everyday category</label>
                      <div className="d-flex flex-wrap gap-1">
                        {EVERYDAY_CATEGORIES.map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`btn btn-sm ${
                              tagCategory === c && !tagCustomCategory.trim()
                                ? 'btn-primary'
                                : 'btn-outline-secondary'
                            }`}
                            onClick={() => {
                              setTagCategory(c)
                              setTagCustomCategory('')
                            }}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {tagReason !== 'ignore' && (
                    <>
                      <label className="form-label">Category (optional)</label>
                      <div className="d-flex flex-wrap gap-1 mb-2">
                        {categories
                          .filter(
                            c =>
                              tagReason !== 'other' ||
                              !EVERYDAY_CATEGORIES.includes(c as (typeof EVERYDAY_CATEGORIES)[number]),
                          )
                          .slice(0, 24)
                          .map(c => (
                          <button
                            key={c}
                            type="button"
                            className={`btn btn-sm ${
                              tagCategory === c && !tagCustomCategory.trim()
                                ? 'btn-primary'
                                : 'btn-outline-secondary'
                            }`}
                            onClick={() => {
                              setTagCategory(c)
                              setTagCustomCategory('')
                            }}
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                      <input
                        className="form-control"
                        placeholder="Or new category"
                        value={tagCustomCategory}
                        onChange={e => setTagCustomCategory(e.target.value)}
                      />
                    </>
                  )}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setTagFor(null)}>
                    Cancel
                  </button>
                  <button type="button" className="btn btn-primary" onClick={saveTag}>
                    Save mark
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {personalFor && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Personal category</h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => {
                      setPersonalFor(null)
                      setCustomCategory('')
                    }}
                  />
                </div>
                <div className="modal-body">
                  <p className="small text-muted">
                    {formatCurrency(personalFor.amount)} ·{' '}
                    {personalFor.description || personalFor.rawSubject}
                  </p>
                  <label className="form-label">Pick a category</label>
                  <div className="d-flex flex-wrap gap-1 mb-3">
                    {categories.map(c => (
                      <button
                        key={c}
                        type="button"
                        className={`btn btn-sm ${
                          pickCategory === c && !customCategory.trim()
                            ? 'btn-info'
                            : 'btn-outline-secondary'
                        }`}
                        onClick={() => {
                          setPickCategory(c)
                          setCustomCategory('')
                        }}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                  <label className="form-label">Or create a new category</label>
                  <input
                    className="form-control"
                    placeholder="e.g. coffee, school fees"
                    value={customCategory}
                    onChange={e => setCustomCategory(e.target.value)}
                  />
                  <div className="form-text">
                    New names are saved and will show up as chips next time.
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => {
                      setPersonalFor(null)
                      setCustomCategory('')
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-info"
                    onClick={() => {
                      const id = personalFor.id
                      const cat = (customCategory.trim() || pickCategory).toLowerCase()
                      if (!cat) {
                        showToast('Enter or pick a category', 'warning')
                        return
                      }
                      setPersonalFor(null)
                      setCustomCategory('')
                      clearHidingFilters()
                      void run(
                        id,
                        () => bankService.setPersonal(id, cat),
                        `Personal · ${cat} · reviewed`,
                      )
                    }}
                  >
                    Save
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {tagsFor && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Tags</h5>
                  <button type="button" className="btn-close" onClick={() => setTagsFor(null)} />
                </div>
                <div className="modal-body">
                  <p className="small text-muted mb-2">
                    Extra labels (comma-separated). Separate from Personal categories.
                  </p>
                  <input
                    className="form-control"
                    value={tagsDraft}
                    onChange={e => setTagsDraft(e.target.value)}
                    placeholder="upi, gst, shipping"
                  />
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={() => setTagsFor(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => {
                      const id = tagsFor.id
                      const tags = tagsDraft
                        .split(/[,]+/)
                        .map(t => t.trim())
                        .filter(Boolean)
                      setTagsFor(null)
                      void run(id, () => bankService.setTags(id, tags), 'Tags saved')
                    }}
                  >
                    Save tags
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
