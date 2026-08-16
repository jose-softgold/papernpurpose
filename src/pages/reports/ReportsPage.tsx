import { useState } from 'react'
import {
  reportService,
  SalesReportRow,
  ProductProfitabilityRow,
  CustomerSalesRow,
  ProductionReportRow,
} from '../../services/reports'
import { formatCurrency, formatPercent } from '../../utils/format'
import { exportToCSV, exportToExcel } from '../../utils/export'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'

type TabKey = 'sales' | 'profitability' | 'customers' | 'production'

interface DateRange {
  from: string
  to: string
}

function useDateRange() {
  const [range, setRange] = useState<DateRange>({ from: '', to: '' })
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
}: {
  range: DateRange
  setRange: (r: DateRange) => void
  onGenerate: () => void
  loading: boolean
}) {
  return (
    <div className="row g-2 align-items-end mb-3">
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
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Qty</th>
                  <th>Unit Price (₹)</th>
                  <th>Revenue (₹)</th>
                  <th>Cost (₹)</th>
                  <th>Profit (₹)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td>{r.date}</td>
                    <td>{r.customer}</td>
                    <td>{r.product}</td>
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
            </table>
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
              <h6 className="text-muted mb-2">Top {top3.length} Products by Profit</h6>
              {top3.map((r, i) => (
                <div key={r.productId} className="mb-1">
                  <div className="d-flex justify-content-between small mb-1">
                    <span>
                      {i + 1}. {r.product}
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
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-light">
                <tr>
                  <th>Product</th>
                  <th>Units Sold</th>
                  <th>Revenue (₹)</th>
                  <th>Cost (₹)</th>
                  <th>Profit (₹)</th>
                  <th>Margin (%)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.productId}>
                    <td>{r.product}</td>
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
            </table>
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
          <div className="table-responsive">
            <table className="table table-sm table-hover">
              <thead className="table-light">
                <tr>
                  <th>Customer</th>
                  <th>Orders</th>
                  <th>Revenue (₹)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.customerId}>
                    <td>{r.customer}</td>
                    <td>{r.orders}</td>
                    <td>{formatCurrency(r.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
          <div className="table-responsive">
            <table className="table table-sm table-hover">
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
                {rows.map((r, i) => (
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
            </table>
          </div>
          <ExportButtons data={exportData} filename="production-report" show />
        </>
      )}
    </>
  )
}

// ──────────────── Main Page ────────────────
export default function ReportsPage() {
  const [tab, setTab] = useState<TabKey>('sales')

  const tabs: { key: TabKey; label: string }[] = [
    { key: 'sales', label: 'Sales Report' },
    { key: 'profitability', label: 'Product Profitability' },
    { key: 'customers', label: 'Customer Sales' },
    { key: 'production', label: 'Production Report' },
  ]

  return (
    <div>
      <h4 className="mb-3">Reports</h4>
      <ul className="nav nav-tabs mb-3">
        {tabs.map(t => (
          <li key={t.key} className="nav-item">
            <button
              className={`nav-link${tab === t.key ? ' active' : ''}`}
              onClick={() => setTab(t.key)}
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
      </div>
    </div>
  )
}
