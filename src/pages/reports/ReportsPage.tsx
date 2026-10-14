import { Fragment, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  reportService,
  SalesReportRow,
  ProductProfitabilityRow,
  CustomerSalesRow,
  ProductionReportRow,
  BankCashSummary,
} from '../../services/reports'
import {
  BankBooks,
  BankTransaction,
  BankTxStatus,
  Customer,
  Order,
  Material,
  Purchase,
  PurchaseItem,
  Supplier,
  WorkerOption,
} from '../../types'
import { formatCurrency, formatPercent, formatDate } from '../../utils/format'
import { exportToCSV, exportToExcel } from '../../utils/export'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import { orderService } from '../../services/orders'
import { purchaseIsPaid, purchaseService } from '../../services/purchases'
import { materialService } from '../../services/materials'
import { customerService } from '../../services/customers'
import { supplierService } from '../../services/suppliers'
import { usersService } from '../../services/users'
import { bankService } from '../../services/bank'
import { occasionService } from '../../services/occasions'
import { productionService } from '../../services/production'
import { productService } from '../../services/products'

type TabKey = 'sales' | 'profitability' | 'customers' | 'production' | 'purchases' | 'occasions' | 'bank'

interface DateRange {
  from: string
  to: string
}

function isoDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function presetRange(kind: 'this_month' | 'last_month' | 'last_7' | 'last_30'): DateRange {
  const now = new Date()
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (kind === 'this_month') {
    const from = new Date(now.getFullYear(), now.getMonth(), 1)
    const to = new Date(now.getFullYear(), now.getMonth() + 1, 0)
    return { from: isoDate(from), to: isoDate(to) }
  }
  if (kind === 'last_month') {
    const from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const to = new Date(now.getFullYear(), now.getMonth(), 0)
    return { from: isoDate(from), to: isoDate(to) }
  }
  const days = kind === 'last_7' ? 6 : 29
  const from = new Date(end)
  from.setDate(from.getDate() - days)
  return { from: isoDate(from), to: isoDate(end) }
}

function useDateRange(initial?: DateRange) {
  const [range, setRange] = useState<DateRange>(initial ?? { from: '', to: '' })
  const toDates = () => ({
    from: range.from ? new Date(range.from) : undefined,
    to: range.to ? new Date(range.to + 'T23:59:59') : undefined,
  })
  return { range, setRange, toDates }
}

function DateFilter({
  range,
  setRange,
  onGenerate,
  loading,
  presets,
}: {
  range: DateRange
  setRange: (r: DateRange) => void
  onGenerate: () => void
  loading: boolean
  presets?: boolean
}) {
  return (
    <div className="mb-3">
      {presets && (
        <div className="d-flex flex-wrap gap-1 mb-2">
          {(
            [
              ['this_month', 'This month'],
              ['last_month', 'Last month'],
              ['last_7', 'Last 7 days'],
              ['last_30', 'Last 30 days'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className="btn btn-sm btn-outline-secondary"
              onClick={() => setRange(presetRange(key))}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="row g-2 align-items-end">
        <div className="col-auto">
          <label className="form-label mb-1 small">From</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={range.from}
            onChange={e => setRange({ ...range, from: e.target.value })}
          />
        </div>
        <div className="col-auto">
          <label className="form-label mb-1 small">To</label>
          <input
            type="date"
            className="form-control form-control-sm"
            value={range.to}
            onChange={e => setRange({ ...range, to: e.target.value })}
          />
        </div>
        <div className="col-auto">
          <button className="btn btn-primary btn-sm" onClick={onGenerate} disabled={loading}>
            {loading ? 'Generating…' : 'Generate Report'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ExportButtons({
  data,
  filename,
  show,
}: {
  data: Record<string, unknown>[]
  filename: string
  show: boolean
}) {
  if (!show) return null
  return (
    <div className="d-flex gap-2 mt-2">
      <button className="btn btn-outline-secondary btn-sm" onClick={() => exportToCSV(data, filename)}>
        Export CSV
      </button>
      <button className="btn btn-outline-success btn-sm" onClick={() => exportToExcel(data, filename)}>
        Export Excel
      </button>
    </div>
  )
}

// ──────────────── Sales Report ────────────────
function SalesTab() {
  const { range, setRange, toDates } = useDateRange()
  const [rows, setRows] = useState<SalesReportRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const { toasts, showToast } = useToast()

  const generate = async () => {
    setLoading(true)
    try {
      const { from, to } = toDates()
      const data = await reportService.getSalesReport(from, to)
      setRows(data)
    } catch {
      showToast('Failed to generate Sales Report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const exportData: Record<string, unknown>[] = (rows ?? []).map(r => ({
    Date: r.date,
    Customer: r.customer,
    Product: r.product,
    Version: r.version,
    Qty: r.quantity,
    'Unit Price (₹)': r.unitPrice,
    'Revenue (₹)': r.revenue,
    'Cost (₹)': r.cost,
    'Profit (₹)': r.profit,
  }))

  return (
    <>
      <ToastContainer toasts={toasts} />
      <DateFilter range={range} setRange={setRange} onGenerate={generate} loading={loading} />
      {loading ? (
        <LoadingSpinner />
      ) : rows === null ? null : rows.length === 0 ? (
        <EmptyState message="No sales data for the selected period." />
      ) : (
        <>
          <div className="card">
            <DataGrid items={rows} tableClassName="table table-sm table-hover mb-0">
              {pageItems => (
                <>
                  <thead className="table-light">
                    <tr>
                      <th>Date</th>
                      <th>Customer</th>
                      <th>Product</th>
                      <th>Version</th>
                      <th>Qty</th>
                      <th>Unit Price (₹)</th>
                      <th>Revenue (₹)</th>
                      <th>Cost (₹)</th>
                      <th>Profit (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((r, i) => (
                      <tr key={i}>
                        <td>{r.date}</td>
                        <td>{r.customer}</td>
                        <td>{r.product}</td>
                        <td>{r.version}</td>
                        <td>{r.quantity}</td>
                        <td>{formatCurrency(r.unitPrice)}</td>
                        <td>{formatCurrency(r.revenue)}</td>
                        <td>{formatCurrency(r.cost)}</td>
                        <td className={r.profit >= 0 ? 'text-success' : 'text-danger'}>
                          {formatCurrency(r.profit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          </div>
          <ExportButtons data={exportData} filename="sales-report" show />
        </>
      )}
    </>
  )
}

// ──────────────── Product Profitability ────────────────
function ProfitabilityTab() {
  const { range, setRange, toDates } = useDateRange()
  const [rows, setRows] = useState<ProductProfitabilityRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const { toasts, showToast } = useToast()

  const generate = async () => {
    setLoading(true)
    try {
      const { from, to } = toDates()
      const data = await reportService.getProductProfitability(from, to)
      setRows(data)
    } catch {
      showToast('Failed to generate Product Profitability Report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const exportData: Record<string, unknown>[] = (rows ?? []).map(r => ({
    Product: r.product,
    Version: r.version,
    'Units Sold': r.unitsSold,
    'Revenue (₹)': r.revenue,
    'Cost (₹)': r.cost,
    'Profit (₹)': r.profit,
    'Margin (%)': r.margin.toFixed(1),
  }))

  const top3 = rows ? rows.slice(0, 3) : []
  const maxProfit = top3[0]?.profit ?? 1

  return (
    <>
      <ToastContainer toasts={toasts} />
      <DateFilter range={range} setRange={setRange} onGenerate={generate} loading={loading} />
      {loading ? (
        <LoadingSpinner />
      ) : rows === null ? null : rows.length === 0 ? (
        <EmptyState message="No profitability data for the selected period." />
      ) : (
        <>
          {top3.length > 0 && (
            <div className="mb-3">
              <h6 className="text-muted mb-2">Top {top3.length} Product Versions by Profit</h6>
              {top3.map((r, i) => (
                <div key={`${r.productId}-${r.productVersionId}`} className="mb-1">
                  <div className="d-flex justify-content-between small mb-1">
                    <span>
                      {i + 1}. {r.product} ({r.version})
                    </span>
                    <span className="text-success fw-semibold">{formatCurrency(r.profit)}</span>
                  </div>
                  <div className="progress" style={{ height: 8 }}>
                    <div
                      className="progress-bar bg-success"
                      style={{ width: `${(r.profit / maxProfit) * 100}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="card">
            <DataGrid items={rows} tableClassName="table table-sm table-hover mb-0">
              {pageItems => (
                <>
                  <thead className="table-light">
                    <tr>
                      <th>Product</th>
                      <th>Version</th>
                      <th>Units Sold</th>
                      <th>Revenue (₹)</th>
                      <th>Cost (₹)</th>
                      <th>Profit (₹)</th>
                      <th>Margin (%)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(r => (
                      <tr key={`${r.productId}-${r.productVersionId}`}>
                        <td>{r.product}</td>
                        <td>{r.version}</td>
                        <td>{r.unitsSold}</td>
                        <td>{formatCurrency(r.revenue)}</td>
                        <td>{formatCurrency(r.cost)}</td>
                        <td className={r.profit >= 0 ? 'text-success' : 'text-danger'}>
                          {formatCurrency(r.profit)}
                        </td>
                        <td>{formatPercent(r.margin)}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          </div>
          <ExportButtons data={exportData} filename="product-profitability" show />
        </>
      )}
    </>
  )
}

// ──────────────── Customer Sales ────────────────
function CustomerSalesTab() {
  const { range, setRange, toDates } = useDateRange()
  const [rows, setRows] = useState<CustomerSalesRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const { toasts, showToast } = useToast()

  const generate = async () => {
    setLoading(true)
    try {
      const { from, to } = toDates()
      const data = await reportService.getCustomerSales(from, to)
      setRows(data)
    } catch {
      showToast('Failed to generate Customer Sales Report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const exportData: Record<string, unknown>[] = (rows ?? []).map(r => ({
    Customer: r.customer,
    Orders: r.orders,
    'Revenue (₹)': r.revenue,
  }))

  return (
    <>
      <ToastContainer toasts={toasts} />
      <DateFilter range={range} setRange={setRange} onGenerate={generate} loading={loading} />
      {loading ? (
        <LoadingSpinner />
      ) : rows === null ? null : rows.length === 0 ? (
        <EmptyState message="No customer sales data for the selected period." />
      ) : (
        <>
          <div className="card">
            <DataGrid items={rows} tableClassName="table table-sm table-hover mb-0">
              {pageItems => (
                <>
                  <thead className="table-light">
                    <tr>
                      <th>Customer</th>
                      <th>Orders</th>
                      <th>Revenue (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(r => (
                      <tr key={r.customerId}>
                        <td>{r.customer}</td>
                        <td>{r.orders}</td>
                        <td>{formatCurrency(r.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          </div>
          <ExportButtons data={exportData} filename="customer-sales" show />
        </>
      )}
    </>
  )
}

// ──────────────── Production Report ────────────────
function ProductionTab() {
  const { range, setRange, toDates } = useDateRange()
  const [rows, setRows] = useState<ProductionReportRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const { toasts, showToast } = useToast()

  const generate = async () => {
    setLoading(true)
    try {
      const { from, to } = toDates()
      const data = await reportService.getProductionReport(from, to)
      setRows(data)
    } catch {
      showToast('Failed to generate Production Report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const exportData: Record<string, unknown>[] = (rows ?? []).map(r => ({
    Date: r.date,
    Product: r.product,
    Version: r.version,
    Qty: r.quantity,
    'Cost/Unit (₹)': r.costPerUnit,
    'Total Cost (₹)': r.totalCost,
  }))

  return (
    <>
      <ToastContainer toasts={toasts} />
      <DateFilter range={range} setRange={setRange} onGenerate={generate} loading={loading} />
      {loading ? (
        <LoadingSpinner />
      ) : rows === null ? null : rows.length === 0 ? (
        <EmptyState message="No production data for the selected period." />
      ) : (
        <>
          <div className="card">
            <DataGrid items={rows} tableClassName="table table-sm table-hover mb-0">
              {pageItems => (
                <>
                  <thead className="table-light">
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Version</th>
                      <th>Qty</th>
                      <th>Cost/Unit (₹)</th>
                      <th>Total Cost (₹)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map((r, i) => (
                      <tr key={i}>
                        <td>{r.date}</td>
                        <td>{r.product}</td>
                        <td>{r.version}</td>
                        <td>{r.quantity}</td>
                        <td>{formatCurrency(r.costPerUnit)}</td>
                        <td>{formatCurrency(r.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          </div>
          <ExportButtons data={exportData} filename="production-report" show />
        </>
      )}
    </>
  )
}

// ──────────────── Bank / Cash ────────────────
type BankReasonFilter = 'all' | 'customer' | 'logistics' | 'recce' | 'worker' | 'purchase' | 'other'

function reasonLabel(tx: BankTransaction): string {
  const parts: string[] = []
  if (tx.paymentKind) parts.push(`payment:${tx.paymentKind}`)
  if (tx.expenseKind) parts.push(tx.expenseKind)
  if (tx.workerPayKind) parts.push(`worker:${tx.workerPayKind}`)
  if (tx.category || tx.personalCategory) parts.push(tx.category || tx.personalCategory || '')
  return parts.filter(Boolean).join(' · ') || '—'
}

function BankCashTab() {
  const { range, setRange, toDates } = useDateRange(presetRange('this_month'))
  const [rows, setRows] = useState<BankTransaction[] | null>(null)
  const [summary, setSummary] = useState<BankCashSummary | null>(null)
  const [loading, setLoading] = useState(false)
  const { toasts, showToast } = useToast()

  const [booksFilter, setBooksFilter] = useState<'all' | BankBooks>('all')
  const [directionFilter, setDirectionFilter] = useState<'all' | 'credit' | 'debit'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | BankTxStatus>('all')
  const [reasonFilter, setReasonFilter] = useState<BankReasonFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [search, setSearch] = useState('')

  const [orders, setOrders] = useState<Order[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [workers, setWorkers] = useState<WorkerOption[]>([])

  useEffect(() => {
    void Promise.all([
      orderService.getAll().catch(() => [] as Order[]),
      purchaseService.getAll().catch(() => [] as Purchase[]),
      customerService.getAll().catch(() => [] as Customer[]),
      supplierService.getAll().catch(() => [] as Supplier[]),
      usersService.listWorkers().catch(() => [] as WorkerOption[]),
    ]).then(([o, p, c, s, w]) => {
      setOrders(o)
      setPurchases(p)
      setCustomers(c)
      setSuppliers(s)
      setWorkers(w)
    })
  }, [])

  const customerMap = useMemo(
    () => Object.fromEntries(customers.map(c => [c.id, c.name])),
    [customers],
  )
  const supplierMap = useMemo(
    () => Object.fromEntries(suppliers.map(s => [s.id, s.name])),
    [suppliers],
  )
  const workerMap = useMemo(() => Object.fromEntries(workers.map(w => [w.id, w.name])), [workers])

  const generate = async () => {
    setLoading(true)
    try {
      const { from, to } = toDates()
      const data = await reportService.getBankCashReport(from, to)
      setRows(data.rows)
      setSummary(data.summary)
    } catch {
      showToast('Failed to generate Bank / Cash report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const categoryOptions = useMemo(() => {
    if (!rows) return []
    const set = new Set<string>()
    for (const t of rows) {
      const c = (t.category || t.personalCategory || '').trim().toLowerCase()
      if (c) set.add(c)
    }
    return [...set].sort()
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    return rows.filter(tx => {
      const books = bankService.booksOf(tx)
      if (booksFilter !== 'all' && books !== booksFilter) return false
      if (directionFilter !== 'all' && tx.direction !== directionFilter) return false
      if (statusFilter !== 'all' && tx.status !== statusFilter) return false
      if (reasonFilter !== 'all' && bankService.reasonKind(tx) !== reasonFilter) return false
      if (categoryFilter !== 'all') {
        const c = (tx.category || tx.personalCategory || '').trim().toLowerCase()
        if (c !== categoryFilter) return false
      }
      if (search.trim()) {
        const q = search.toLowerCase()
        const hay = [
          tx.description,
          tx.counterparty,
          tx.bankName,
          tx.category,
          tx.personalCategory,
          tx.paymentKind,
          tx.expenseKind,
          tx.workerPayKind,
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
  }, [
    rows,
    booksFilter,
    directionFilter,
    statusFilter,
    reasonFilter,
    categoryFilter,
    search,
    workerMap,
  ])

  function linkText(tx: BankTransaction): string {
    const parts: string[] = []
    if (tx.orderId) {
      const o = orders.find(x => x.id === tx.orderId)
      parts.push(
        o
          ? `Order: ${customerMap[o.customerId] || 'Customer'} (${o.status})`
          : `Order ${tx.orderId.slice(0, 6)}`,
      )
    }
    if (tx.purchaseId) {
      const p = purchases.find(x => x.id === tx.purchaseId)
      parts.push(
        p
          ? `Purchase: ${supplierMap[p.supplierId] || 'Supplier'}${p.purchasedByName ? ` · ${p.purchasedByName}` : ''}`
          : `Purchase ${tx.purchaseId.slice(0, 6)}`,
      )
    }
    if (tx.workerId) parts.push(workerMap[tx.workerId] || tx.workerId.slice(0, 6))
    return parts.join(' · ') || '—'
  }

  const exportData: Record<string, unknown>[] = filtered.map(tx => ({
    Date: tx.occurredAt?.toDate?.()?.toISOString().slice(0, 10) || '',
    Amount: tx.amount,
    Direction: tx.direction,
    Books: bankService.booksOf(tx),
    Reason: reasonLabel(tx),
    Status: tx.status,
    Links: linkText(tx),
    Description: tx.description || tx.rawSubject || '',
    Counterparty: tx.counterparty || '',
    Category: tx.category || tx.personalCategory || '',
  }))

  const filename = `bank-cash-${range.from || 'all'}-to-${range.to || 'all'}`

  return (
    <>
      <ToastContainer toasts={toasts} />
      <DateFilter range={range} setRange={setRange} onGenerate={() => void generate()} loading={loading} presets />
      {loading && <LoadingSpinner />}
      {!loading && rows === null && (
        <EmptyState message="Pick a month or date range, then generate the Bank / Cash report." />
      )}
      {!loading && rows && summary && (
        <>
          <div className="row g-2 mb-3">
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Business in</div>
                <div className="fw-semibold text-success">{formatCurrency(summary.businessIn)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Business out</div>
                <div className="fw-semibold text-danger">{formatCurrency(summary.businessOut)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Personal net</div>
                <div className="fw-semibold">{formatCurrency(summary.personalNet)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Customer payments</div>
                <div className="fw-semibold text-success">{formatCurrency(summary.customerPayments)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Logistics</div>
                <div className="fw-semibold">{formatCurrency(summary.logistics)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Recce</div>
                <div className="fw-semibold">{formatCurrency(summary.recce)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Worker float out</div>
                <div className="fw-semibold">{formatCurrency(summary.workerFloatOut)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Worker float spend</div>
                <div className="fw-semibold">{formatCurrency(summary.workerFloatSpend)}</div>
              </div>
            </div>
          </div>

          <div className="d-flex flex-wrap gap-2 align-items-end mb-3">
            <div>
              <label className="form-label small mb-0">Books</label>
              <select
                className="form-select form-select-sm"
                value={booksFilter}
                onChange={e => setBooksFilter(e.target.value as 'all' | BankBooks)}
              >
                <option value="all">All</option>
                <option value="business">Business</option>
                <option value="personal">Personal</option>
                <option value="unassigned">Unassigned</option>
              </select>
            </div>
            <div>
              <label className="form-label small mb-0">Direction</label>
              <select
                className="form-select form-select-sm"
                value={directionFilter}
                onChange={e => setDirectionFilter(e.target.value as 'all' | 'credit' | 'debit')}
              >
                <option value="all">All</option>
                <option value="credit">Credit</option>
                <option value="debit">Debit</option>
              </select>
            </div>
            <div>
              <label className="form-label small mb-0">Status</label>
              <select
                className="form-select form-select-sm"
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as 'all' | BankTxStatus)}
              >
                <option value="all">All</option>
                <option value="pending">Pending</option>
                <option value="reviewed">Reviewed</option>
                <option value="matched">Matched</option>
                <option value="ignored">Ignored</option>
              </select>
            </div>
            <div>
              <label className="form-label small mb-0">Reason</label>
              <select
                className="form-select form-select-sm"
                value={reasonFilter}
                onChange={e => setReasonFilter(e.target.value as BankReasonFilter)}
              >
                <option value="all">All</option>
                <option value="customer">Customer payment</option>
                <option value="logistics">Logistics</option>
                <option value="recce">Recce</option>
                <option value="worker">Worker</option>
                <option value="purchase">Purchase</option>
                <option value="other">Other / untagged</option>
              </select>
            </div>
            <div>
              <label className="form-label small mb-0">Category</label>
              <select
                className="form-select form-select-sm"
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
              >
                <option value="all">All</option>
                {categoryOptions.map(c => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-grow-1" style={{ minWidth: 160 }}>
              <label className="form-label small mb-0">Search</label>
              <input
                className="form-control form-control-sm"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Description, category…"
              />
            </div>
            <div className="small text-muted pb-1">{filtered.length} / {rows.length} rows</div>
          </div>

          {filtered.length === 0 ? (
            <EmptyState message="No bank transactions for this filter." />
          ) : (
            <DataGrid
              items={filtered}
              resetKey={`${booksFilter}-${directionFilter}-${statusFilter}-${reasonFilter}-${categoryFilter}-${search}-${range.from}-${range.to}`}
              tableClassName="table table-sm table-hover mb-0"
            >
              {pageItems => (
                <>
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Amount</th>
                      <th>Books</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th>Links</th>
                      <th>Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageItems.map(tx => (
                      <tr key={tx.id}>
                        <td className="small text-nowrap">{formatDate(tx.occurredAt)}</td>
                        <td className="text-nowrap">
                          <span className={tx.direction === 'credit' ? 'text-success' : 'text-danger'}>
                            {tx.direction === 'credit' ? '+' : '−'}
                            {formatCurrency(tx.amount)}
                          </span>
                        </td>
                        <td>
                          <span className="badge text-bg-secondary">{bankService.booksOf(tx)}</span>
                        </td>
                        <td className="small">{reasonLabel(tx)}</td>
                        <td>
                          <span className="badge text-bg-light border">{tx.status}</span>
                        </td>
                        <td className="small">{linkText(tx)}</td>
                        <td className="small">{tx.description || tx.rawSubject || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </>
              )}
            </DataGrid>
          )}
          <ExportButtons data={exportData} filename={filename} show={filtered.length > 0} />
        </>
      )}
    </>
  )
}

// ──────────────── Purchases Report ────────────────
interface PurchaseReportLine {
  id: string
  dateMs: number
  dateLabel: string
  vendor: string
  amountPaid: number
  subtotal: number
  rate: number
  qty: number
  item: string
  paidBy: string
  paymentStatus: 'Paid' | 'Not paid'
}

function PurchasesTab() {
  const { toasts, showToast } = useToast()
  const { range, setRange, toDates } = useDateRange(presetRange('this_month'))
  const [lines, setLines] = useState<PurchaseReportLine[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [paidBy, setPaidBy] = useState('')
  const [status, setStatus] = useState<'all' | 'paid' | 'unpaid'>('all')

  const generate = async () => {
    setLoading(true)
    try {
      const { from, to } = toDates()
      const [purchases, items, suppliers, materials, bankRows] = await Promise.all([
        purchaseService.getAll(),
        purchaseService.listItems(),
        supplierService.getAll(),
        materialService.getAll(),
        bankService.getAll({ max: 500 }).catch(() => [] as BankTransaction[]),
      ])
      const bankPaid: Record<string, number> = {}
      for (const t of bankRows) {
        const ids = t.purchaseIds?.length ? t.purchaseIds : (t.purchaseId ? [t.purchaseId] : [])
        for (const id of ids) bankPaid[id] = (bankPaid[id] ?? 0) + Number(t.amount || 0)
      }
      const supplierMap = Object.fromEntries(suppliers.map(s => [s.id, s.name]))
      const materialMap = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]))
      const itemsByPurchase = new Map<string, PurchaseItem[]>()
      for (const item of items) {
        const list = itemsByPurchase.get(item.purchaseId) ?? []
        list.push(item)
        itemsByPurchase.set(item.purchaseId, list)
      }
      const next: PurchaseReportLine[] = []
      for (const p of purchases) {
        const ms = p.purchaseDate?.toMillis?.() ?? 0
        if (from && ms < from.getTime()) continue
        if (to && ms > to.getTime()) continue
        const settled = purchaseIsPaid(p, bankPaid[p.id] ?? 0)
        const statusLabel: PurchaseReportLine['paymentStatus'] = settled ? 'Paid' : 'Not paid'
        const base = {
          dateMs: ms,
          dateLabel: formatDate(p.purchaseDate),
          vendor: supplierMap[p.supplierId] || p.supplierId,
          paidBy: p.purchasedByName || '',
          paymentStatus: statusLabel,
        }
        const purchaseItems = itemsByPurchase.get(p.id) ?? []
        if (!purchaseItems.length) {
          next.push({
            ...base,
            id: p.id,
            amountPaid: Number(p.grandTotal ?? p.total ?? 0),
            subtotal: Number(p.taxableSubtotal ?? p.total ?? 0),
            rate: 0,
            qty: Number(p.totalQty ?? 0),
            item: '',
          })
          continue
        }
        for (const item of purchaseItems) {
          next.push({
            ...base,
            id: item.id,
            amountPaid: Number(item.total ?? 0),
            subtotal: Number(item.taxableAmount ?? item.total ?? 0),
            rate: Number(item.unitCost ?? 0),
            qty: Number(item.quantity ?? 0),
            item: item.kind === 'charge'
              ? `${item.description || 'Charge'} (charge)`
              : materialMap[item.materialId] || item.materialId,
          })
        }
        if (p.logisticsTotal && p.logistics) {
          next.push({
            ...base,
            id: `${p.id}-delivery`,
            amountPaid: Number(p.logisticsTotal),
            subtotal: Number(p.logistics.amount ?? 0),
            rate: Number(p.logistics.amount ?? 0),
            qty: 1,
            item: `${['Delivery', p.logistics.mode].filter(Boolean).join(' · ')} (charge)`,
          })
        }
      }
      next.sort((a, b) => b.dateMs - a.dateMs)
      setLines(next)
      setPaidBy('')
      setStatus('all')
    } catch (err) {
      console.error(err)
      showToast('Failed to generate purchases report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  const people = useMemo(
    () => [...new Set((lines ?? []).map(l => l.paidBy).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [lines],
  )

  const filtered = useMemo(() => {
    if (!lines) return []
    return lines.filter(l => {
      if (paidBy && l.paidBy !== paidBy) return false
      if (status === 'paid' && l.paymentStatus !== 'Paid') return false
      if (status === 'unpaid' && l.paymentStatus !== 'Not paid') return false
      return true
    })
  }, [lines, paidBy, status])

  const amount = filtered.reduce((s, l) => s + l.amountPaid, 0)
  const openAmount = filtered.filter(l => l.paymentStatus === 'Not paid').reduce((s, l) => s + l.amountPaid, 0)

  const exportData: Record<string, unknown>[] = filtered.map(l => ({
    Date: l.dateLabel,
    Vendor: l.vendor,
    'Amount paid': l.amountPaid,
    Subtotal: l.subtotal,
    Rate: l.rate,
    Qty: l.qty,
    Item: l.item,
    'Paid by': l.paidBy,
    'Payment status': l.paymentStatus,
  }))

  return (
    <>
      <ToastContainer toasts={toasts} />
      <DateFilter range={range} setRange={setRange} onGenerate={() => void generate()} loading={loading} presets />
      {loading && <LoadingSpinner />}
      {!loading && lines === null && (
        <EmptyState message="Pick a date range, then generate the purchases report." />
      )}
      {!loading && lines && (
        <>
          <div className="row g-2 mb-3">
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Lines</div>
                <div className="fw-semibold">{filtered.length}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Amount paid</div>
                <div className="fw-semibold">{formatCurrency(amount)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Still open</div>
                <div className="fw-semibold">{formatCurrency(openAmount)}</div>
              </div>
            </div>
          </div>
          <div className="row g-2 mb-3">
            <div className="col-auto">
              <label className="form-label mb-1 small">Paid by</label>
              <select className="form-select form-select-sm" value={paidBy} onChange={e => setPaidBy(e.target.value)}>
                <option value="">Everyone</option>
                {people.map(name => <option key={name} value={name}>{name}</option>)}
              </select>
            </div>
            <div className="col-auto">
              <label className="form-label mb-1 small">Payment status</label>
              <select
                className="form-select form-select-sm"
                value={status}
                onChange={e => setStatus(e.target.value === 'paid' || e.target.value === 'unpaid' ? e.target.value : 'all')}
              >
                <option value="all">All</option>
                <option value="paid">Paid</option>
                <option value="unpaid">Not paid</option>
              </select>
            </div>
          </div>
          <DataGrid
            items={filtered}
            empty={<EmptyState message="No purchases in this range." />}
          >
            {pageItems => (
              <>
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Vendor</th>
                    <th>Amount paid</th>
                    <th>Subtotal</th>
                    <th>Rate</th>
                    <th>Qty</th>
                    <th>Item</th>
                    <th>Paid by</th>
                    <th>Payment status</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(l => (
                    <tr key={l.id}>
                      <td>{l.dateLabel}</td>
                      <td>{l.vendor}</td>
                      <td>{formatCurrency(l.amountPaid)}</td>
                      <td>{formatCurrency(l.subtotal)}</td>
                      <td>{formatCurrency(l.rate)}</td>
                      <td>{l.qty}</td>
                      <td>{l.item || '—'}</td>
                      <td>{l.paidBy || '—'}</td>
                      <td>
                        <span className={`badge ${l.paymentStatus === 'Paid' ? 'text-bg-success' : 'text-bg-warning'}`}>
                          {l.paymentStatus}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </DataGrid>
          <ExportButtons data={exportData} filename="purchases-report" show={filtered.length > 0} />
        </>
      )}
    </>
  )
}

// ──────────────── Occasions ────────────────
const UNASSIGNED_SEASON = '__unassigned__'
const NON_SALE_STATUSES: Order['status'][] = ['DRAFT', 'QUOTED', 'CANCELLED']

interface OccasionTop {
  name: string
  qty: number
  amount: number
}

interface OccasionRow {
  key: string
  name: string
  year: number | null
  status: string
  bills: number
  purchases: number
  productionQty: number
  productionCost: number
  unitsSold: number
  revenue: number
  cogs: number
  profit: number
  /** qty = number of bills paid */
  payers: OccasionTop[]
  topMaterials: OccasionTop[]
  topProducts: OccasionTop[]
}

function topOf(map: Map<string, OccasionTop>, limit = 5): OccasionTop[] {
  return [...map.values()].sort((a, b) => b.amount - a.amount).slice(0, limit)
}

function OccasionsTab() {
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const canSeeSpend = isAdminOrOwner(role)
  const [rows, setRows] = useState<OccasionRow[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [year, setYear] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const generate = async () => {
    setLoading(true)
    try {
      const [seasons, purchases, purchaseItems, productions, orders, products, materials] = await Promise.all([
        occasionService.getAllSeasons(),
        canSeeSpend ? purchaseService.getAll() : Promise.resolve([] as Purchase[]),
        canSeeSpend ? purchaseService.listItems() : Promise.resolve([] as PurchaseItem[]),
        productionService.getAll(),
        orderService.getAll(),
        productService.getAll(),
        materialService.getAll(),
      ])
      const saleOrders = orders.filter(o => !NON_SALE_STATUSES.includes(o.status))
      const orderItems = await orderService.getItemsForOrders(saleOrders.map(o => o.id))
      const productName = Object.fromEntries(products.map(p => [p.id, p.name]))
      const materialName = Object.fromEntries(materials.map((m: Material) => [m.id, m.name]))
      const seasonIds = new Set(seasons.map(s => s.id))

      const acc = new Map<string, OccasionRow & { pays: Map<string, OccasionTop>; mats: Map<string, OccasionTop>; prods: Map<string, OccasionTop> }>()
      const rowFor = (seasonId: string | null | undefined) => {
        const key = seasonId && seasonIds.has(seasonId) ? seasonId : UNASSIGNED_SEASON
        let row = acc.get(key)
        if (!row) {
          const s = seasons.find(x => x.id === key)
          row = {
            key,
            name: s?.name ?? 'Unassigned',
            year: s?.year ?? null,
            status: s?.status ?? '',
            bills: 0, purchases: 0, productionQty: 0, productionCost: 0,
            unitsSold: 0, revenue: 0, cogs: 0, profit: 0,
            payers: [], topMaterials: [], topProducts: [],
            pays: new Map(), mats: new Map(), prods: new Map(),
          }
          acc.set(key, row)
        }
        return row
      }
      seasons.forEach(s => rowFor(s.id))

      const purchaseSeason = new Map(purchases.map(p => [p.id, p.occasionSeasonId ?? null]))
      for (const p of purchases) {
        const row = rowFor(p.occasionSeasonId)
        const amount = Number(p.grandTotal ?? p.total ?? 0)
        row.bills += 1
        row.purchases += amount
        const payerKey = p.purchasedById || p.purchasedByName || ''
        const payer = row.pays.get(payerKey) ?? { name: p.purchasedByName || 'Not recorded', qty: 0, amount: 0 }
        payer.qty += 1
        payer.amount += amount
        row.pays.set(payerKey, payer)
      }
      for (const item of purchaseItems) {
        if (item.kind === 'charge' || !item.materialId || !purchaseSeason.has(item.purchaseId)) continue
        const row = rowFor(purchaseSeason.get(item.purchaseId))
        const name = materialName[item.materialId] || item.materialId
        const top = row.mats.get(item.materialId) ?? { name, qty: 0, amount: 0 }
        top.qty += Number(item.quantity || 0)
        top.amount += Number(item.total || 0)
        row.mats.set(item.materialId, top)
      }

      for (const p of productions) {
        if (p.status !== 'COMPLETED') continue
        const row = rowFor(p.occasionSeasonId)
        row.productionQty += Number(p.actualQuantity ?? p.quantity ?? 0)
        row.productionCost += Number(p.totalMaterialCost || 0)
      }

      const seasonByOccasionYear = (occasionId: string | null | undefined, y: number) =>
        occasionId ? seasons.find(s => s.occasionId === occasionId && s.year === y)?.id ?? null : null
      for (const o of saleOrders) {
        const when = (o.eventDate ?? o.orderDate)?.toDate?.() ?? new Date()
        const fallback = seasonByOccasionYear(o.occasionId, when.getFullYear())
        for (const item of orderItems[o.id] ?? []) {
          const row = rowFor(item.occasionSeasonId || fallback)
          const revenue = Number(item.taxableAmount ?? item.totalPrice ?? 0)
          row.unitsSold += Number(item.quantity || 0)
          row.revenue += revenue
          row.cogs += Number(item.totalCost || 0)
          row.profit += Number(item.profit ?? revenue - Number(item.totalCost || 0))
          const name = productName[item.productId] || item.productId
          const top = row.prods.get(item.productId) ?? { name, qty: 0, amount: 0 }
          top.qty += Number(item.quantity || 0)
          top.amount += revenue
          row.prods.set(item.productId, top)
        }
      }

      const statusRank: Record<string, number> = { active: 0, upcoming: 1, closed: 2 }
      const next = [...acc.values()]
        .map(({ pays, mats, prods, ...row }) => ({
          ...row,
          payers: topOf(pays, Infinity),
          topMaterials: topOf(mats),
          topProducts: topOf(prods),
        }))
        .filter(r => r.key !== UNASSIGNED_SEASON || r.bills || r.productionQty || r.unitsSold)
        .sort((a, b) => {
          if (a.key === UNASSIGNED_SEASON) return 1
          if (b.key === UNASSIGNED_SEASON) return -1
          return (b.year ?? 0) - (a.year ?? 0) || (statusRank[a.status] ?? 3) - (statusRank[b.status] ?? 3) || a.name.localeCompare(b.name)
        })
      setRows(next)
      setExpanded(null)
    } catch (err) {
      console.error(err)
      showToast('Failed to generate occasions report', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void generate() }, [])

  const years = useMemo(
    () => [...new Set((rows ?? []).map(r => r.year).filter((y): y is number => y !== null))].sort((a, b) => b - a),
    [rows],
  )
  const filtered = useMemo(
    () => (rows ?? []).filter(r => !year || r.year === Number(year)),
    [rows, year],
  )
  const totals = filtered.reduce(
    (t, r) => ({ purchases: t.purchases + r.purchases, revenue: t.revenue + r.revenue, profit: t.profit + r.profit }),
    { purchases: 0, revenue: 0, profit: 0 },
  )
  const margin = (r: { revenue: number; profit: number }) => (r.revenue > 0 ? (r.profit / r.revenue) * 100 : 0)

  const exportData: Record<string, unknown>[] = filtered.map(r => ({
    Occasion: r.name,
    Year: r.year ?? '',
    Status: r.status,
    ...(canSeeSpend
      ? {
          Bills: r.bills,
          'Purchases (₹)': r.purchases,
          'Paid by': r.payers.map(p => `${p.name}: ${p.amount.toFixed(2)} (${p.qty} bill${p.qty === 1 ? '' : 's'})`).join('; '),
        }
      : {}),
    'Produced qty': r.productionQty,
    'Production cost (₹)': r.productionCost,
    'Units sold': r.unitsSold,
    'Revenue ex GST (₹)': r.revenue,
    'Cost of goods (₹)': r.cogs,
    'Gross profit (₹)': r.profit,
    'Margin %': Number(margin(r).toFixed(1)),
    ...(canSeeSpend ? { 'Net after purchases (₹)': r.revenue - r.purchases } : {}),
  }))

  const colCount = canSeeSpend ? 10 : 8

  return (
    <>
      <ToastContainer toasts={toasts} />
      <div className="row g-2 align-items-end mb-3">
        <div className="col-auto">
          <label className="form-label mb-1 small">Year</label>
          <select className="form-select form-select-sm" value={year} onChange={e => setYear(e.target.value)}>
            <option value="">All years</option>
            {years.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="col-auto">
          <button className="btn btn-sm btn-primary" onClick={() => void generate()} disabled={loading}>
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>
      </div>
      {loading && <LoadingSpinner />}
      {!loading && rows && (
        <>
          <div className="row g-2 mb-3">
            {canSeeSpend && (
              <div className="col-6 col-md-3">
                <div className="border rounded p-2 h-100">
                  <div className="small text-muted">Purchases</div>
                  <div className="fw-semibold">{formatCurrency(totals.purchases)}</div>
                </div>
              </div>
            )}
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Revenue (ex GST)</div>
                <div className="fw-semibold">{formatCurrency(totals.revenue)}</div>
              </div>
            </div>
            <div className="col-6 col-md-3">
              <div className="border rounded p-2 h-100">
                <div className="small text-muted">Gross profit</div>
                <div className="fw-semibold">{formatCurrency(totals.profit)} · {formatPercent(margin(totals))}</div>
              </div>
            </div>
          </div>
          {filtered.length === 0 ? (
            <EmptyState message="No occasion seasons yet. Open a season in Settings → Occasions." />
          ) : (
            <div className="table-responsive">
              <table className="table table-sm table-hover align-middle mb-0">
                <thead className="table-light">
                  <tr>
                    <th>Occasion</th>
                    {canSeeSpend && <th className="text-end">Purchases</th>}
                    <th className="text-end">Produced</th>
                    <th className="text-end">Production cost</th>
                    <th className="text-end">Units sold</th>
                    <th className="text-end">Revenue</th>
                    <th className="text-end">Gross profit</th>
                    <th className="text-end">Margin</th>
                    {canSeeSpend && <th className="text-end">Net after purchases</th>}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(r => {
                    const open = expanded === r.key
                    return (
                      <Fragment key={r.key}>
                        <tr role="button" onClick={() => setExpanded(open ? null : r.key)}>
                          <td>
                            <div className="fw-semibold">{r.name}</div>
                            {r.status && <span className={`badge ${r.status === 'active' ? 'text-bg-success' : 'text-bg-secondary'}`}>{r.status}</span>}
                          </td>
                          {canSeeSpend && (
                            <td className="text-end">
                              {formatCurrency(r.purchases)}
                              <div className="small text-muted">{r.bills} bill{r.bills === 1 ? '' : 's'}</div>
                            </td>
                          )}
                          <td className="text-end">{r.productionQty}</td>
                          <td className="text-end">{formatCurrency(r.productionCost)}</td>
                          <td className="text-end">{r.unitsSold}</td>
                          <td className="text-end">{formatCurrency(r.revenue)}</td>
                          <td className={`text-end ${r.profit < 0 ? 'text-danger' : ''}`}>{formatCurrency(r.profit)}</td>
                          <td className="text-end">{r.revenue > 0 ? formatPercent(margin(r)) : '—'}</td>
                          {canSeeSpend && (
                            <td className={`text-end ${r.revenue - r.purchases < 0 ? 'text-danger' : ''}`}>
                              {formatCurrency(r.revenue - r.purchases)}
                            </td>
                          )}
                          <td className="text-muted small">{open ? '▲' : '▼'}</td>
                        </tr>
                        {open && (
                          <tr className="table-light">
                            <td colSpan={colCount}>
                              <div className="row g-3 py-1">
                                {canSeeSpend && (
                                  <div className="col-md-4">
                                    <div className="small fw-semibold mb-1">Who paid</div>
                                    {r.payers.length === 0 ? (
                                      <div className="small text-muted">No purchases tagged to this occasion.</div>
                                    ) : (
                                      <ul className="list-unstyled small mb-0">
                                        {r.payers.map((p, i) => (
                                          <li key={`${p.name}-${i}`} className="d-flex justify-content-between gap-2">
                                            <span>{p.name} <span className="text-muted">· {p.qty} bill{p.qty === 1 ? '' : 's'}</span></span>
                                            <span>{formatCurrency(p.amount)}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                )}
                                {canSeeSpend && (
                                  <div className="col-md-4">
                                    <div className="small fw-semibold mb-1">Top materials bought</div>
                                    {r.topMaterials.length === 0 ? (
                                      <div className="small text-muted">No purchases tagged to this occasion.</div>
                                    ) : (
                                      <ul className="list-unstyled small mb-0">
                                        {r.topMaterials.map(m => (
                                          <li key={m.name} className="d-flex justify-content-between">
                                            <span>{m.name} × {m.qty}</span>
                                            <span>{formatCurrency(m.amount)}</span>
                                          </li>
                                        ))}
                                      </ul>
                                    )}
                                  </div>
                                )}
                                <div className={canSeeSpend ? 'col-md-4' : 'col-md-6'}>
                                  <div className="small fw-semibold mb-1">Top products sold</div>
                                  {r.topProducts.length === 0 ? (
                                    <div className="small text-muted">No sales for this occasion yet.</div>
                                  ) : (
                                    <ul className="list-unstyled small mb-0">
                                      {r.topProducts.map(p => (
                                        <li key={p.name} className="d-flex justify-content-between">
                                          <span>{p.name} × {p.qty}</span>
                                          <span>{formatCurrency(p.amount)}</span>
                                        </li>
                                      ))}
                                    </ul>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
          <ExportButtons data={exportData} filename="occasions-report" show={filtered.length > 0} />
        </>
      )}
    </>
  )
}

// ──────────────── Main Page ────────────────
export default function ReportsPage() {
  const { role } = useAuth()
  const canBank = isAdminOrOwner(role)
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const initialTab: TabKey =
    tabParam === 'bank' && canBank
      ? 'bank'
      : tabParam === 'profitability' ||
          tabParam === 'customers' ||
          tabParam === 'production' ||
          tabParam === 'purchases' ||
          tabParam === 'occasions' ||
          tabParam === 'sales'
        ? tabParam
        : 'sales'
  const [tab, setTab] = useState<TabKey>(initialTab)

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'sales', label: 'Sales Report' },
    { key: 'profitability', label: 'Product Profitability' },
    { key: 'customers', label: 'Customer Sales' },
    { key: 'production', label: 'Production Report' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'occasions', label: 'Occasions' },
    ...(canBank ? [{ key: 'bank' as const, label: 'Bank / Cash' }] : []),
  ]

  useEffect(() => {
    if (!canBank && tab === 'bank') setTab('sales')
  }, [canBank, tab])

  useEffect(() => {
    if (tabParam === 'bank' && canBank) setTab('bank')
    if (tabParam === 'purchases' || tabParam === 'occasions') setTab(tabParam)
  }, [tabParam, canBank])

  function selectTab(next: TabKey) {
    setTab(next)
    if (next === 'bank' || next === 'purchases' || next === 'occasions') setSearchParams({ tab: next })
    else setSearchParams({})
  }

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Sales, profitability, production, purchases, and bank cash over any date range"
        icon="📈"
      />
      <ul className="nav nav-tabs mb-3">
        {tabs.map(t => (
          <li key={t.key} className="nav-item">
            <button
              className={`nav-link${tab === t.key ? ' active' : ''}`}
              onClick={() => selectTab(t.key)}
            >
              {t.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="tab-content">
        {tab === 'sales' && <SalesTab />}
        {tab === 'profitability' && <ProfitabilityTab />}
        {tab === 'customers' && <CustomerSalesTab />}
        {tab === 'production' && <ProductionTab />}
        {tab === 'purchases' && <PurchasesTab />}
        {tab === 'occasions' && <OccasionsTab />}
        {tab === 'bank' && canBank && <BankCashTab />}
      </div>
    </div>
  )
}
