import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { inventoryService } from '../services/inventory'
import { reportService, ProductProfitabilityRow } from '../services/reports'
import { buildMetrics, buildOccasionRows, loadDashboardData, type DashboardData, type DashboardFilter } from '../services/dashboard'
import { formatCurrency, formatDate } from '../utils/format'
import { useAuth } from '../hooks/useAuth'
import { isAdminOrOwner } from '../utils/roles'
import LoadingSpinner from '../components/LoadingSpinner'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'
import {
  MaterialsCard, MoneySummary, OccasionCards, OrderPipelineCard, PurchasesCard, TrendChart, WhoPaidCard,
} from '../components/dashboard/DashboardSections'

type Period = 'this_month' | 'last_month' | 'last_90' | 'this_year' | 'all'

const PERIODS: { id: Period; label: string }[] = [
  { id: 'this_month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'last_90', label: 'Last 90 days' },
  { id: 'this_year', label: 'This year' },
  { id: 'all', label: 'All time' },
]

function periodFilter(period: Period): DashboardFilter {
  const now = new Date()
  const endOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999)
  switch (period) {
    case 'this_month':
      return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
    case 'last_month':
      return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: endOfDay(new Date(now.getFullYear(), now.getMonth(), 0)) }
    case 'last_90':
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 89), to: endOfDay(now) }
    case 'this_year':
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfDay(new Date(now.getFullYear(), 11, 31)) }
    default:
      return {}
  }
}

export default function Dashboard() {
  const { role } = useAuth()
  const showSpend = isAdminOrOwner(role)
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<DashboardData | null>(null)
  const [productStocks, setProductStocks] = useState<Record<string, number>>({})
  const [profitability, setProfitability] = useState<ProductProfitabilityRow[]>([])
  const [selection, setSelection] = useState<string>('this_month')

  useEffect(() => {
    Promise.all([
      loadDashboardData({ includeSpend: showSpend }),
      inventoryService.getProductStocks().catch(() => ({} as Record<string, number>)),
      reportService.getProductProfitability().catch(() => [] as ProductProfitabilityRow[]),
    ])
      .then(([d, ps, prof]) => {
        setData(d)
        setProductStocks(ps)
        setProfitability(prof)
      })
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [showSpend])

  const filter: DashboardFilter = useMemo(
    () => (selection.startsWith('season:') ? { seasonId: selection.slice(7) } : periodFilter(selection as Period)),
    [selection],
  )
  const metrics = useMemo(() => (data ? buildMetrics(data, filter) : null), [data, filter])
  const occasionRows = useMemo(() => (data ? buildOccasionRows(data) : []), [data])

  if (loading) return <LoadingSpinner />
  if (!data || !metrics) return <EmptyState icon="📊" message="Could not load the dashboard" description="Refresh the page to try again." />

  const productMap = new Map(data.products.map(p => [p.id, p]))
  const customerMap = new Map(data.customers.map(c => [c.id, c]))
  const selectedSeason = filter.seasonId ? data.seasons.find(s => s.id === filter.seasonId) : null

  const studio = [
    { label: 'Active customers', value: data.customers.filter(c => c.status === 'active').length },
    { label: 'Active products', value: data.products.filter(p => p.status === 'active').length },
    { label: 'Open orders', value: data.orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length },
    { label: 'Material stock value', value: formatCurrency(data.materials.reduce((s, m) => s + (data.materialStocks[m.id] ?? 0) * Number(m.costPerUnit || 0), 0)) },
    { label: 'Finished units', value: Object.values(productStocks).reduce((s, q) => s + q, 0) },
    { label: 'Low stock items', value: metrics.lowStock.length, alert: metrics.lowStock.length > 0 },
  ]

  const recentOrders = data.orders.slice(0, 5)
  const recentProductions = [...data.productions]
    .sort((a, b) => (b.productionDate?.toMillis?.() ?? 0) - (a.productionDate?.toMillis?.() ?? 0))
    .slice(0, 5)
  const topProfitable = [...profitability].sort((a, b) => b.profit - a.profit).slice(0, 5)
  const seasonsSorted = [...data.seasons].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name))

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={selectedSeason ? `Everything for ${selectedSeason.name}` : 'Money, purchases, occasions and orders at a glance'}
        icon="📊"
        actions={
          <>
            {selectedSeason && (
              <Link to={`/occasions/${selectedSeason.id}`} className="btn btn-sm btn-outline-primary">
                Open {selectedSeason.name}
              </Link>
            )}
            <Link to="/" className="btn btn-sm btn-primary">🤖 Ask the AI</Link>
          </>
        }
      />

      <div className="d-flex flex-wrap align-items-center gap-2 mb-3">
        {PERIODS.map(p => (
          <button
            key={p.id}
            type="button"
            className={`btn btn-sm ${selection === p.id ? 'btn-primary' : 'btn-outline-secondary'}`}
            onClick={() => setSelection(p.id)}
          >
            {p.label}
          </button>
        ))}
        {seasonsSorted.length > 0 && (
          <select
            className="form-select form-select-sm w-auto"
            value={selection.startsWith('season:') ? selection : ''}
            onChange={e => setSelection(e.target.value || 'this_month')}
            aria-label="Occasion"
          >
            <option value="">Occasion…</option>
            {seasonsSorted.map(s => (
              <option key={s.id} value={`season:${s.id}`}>{s.name}{s.status === 'active' ? '' : ` (${s.status})`}</option>
            ))}
          </select>
        )}
      </div>

      <MoneySummary money={metrics.money} showSpend={showSpend} />

      {showSpend && (
        <div className="row g-3 mb-3">
          <div className="col-12 col-xl-5"><WhoPaidCard whoPaid={metrics.whoPaid} /></div>
          <div className="col-12 col-xl-7"><PurchasesCard rows={metrics.purchaseRows} /></div>
        </div>
      )}

      <OccasionCards rows={occasionRows} showSpend={showSpend} />

      <div className="mb-3"><TrendChart trend={metrics.trend} showSpend={showSpend} /></div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-xl-6"><OrderPipelineCard pipeline={metrics.pipeline} upcoming={metrics.upcoming} /></div>
        <div className="col-12 col-xl-6">
          <MaterialsCard topMaterials={metrics.topMaterials} lowStock={metrics.lowStock} showSpend={showSpend} />
        </div>
      </div>

      <div className="card mb-3">
        <div className="card-body py-2">
          <div className="d-flex flex-wrap gap-4">
            <span className="small fw-semibold text-muted align-self-center">Studio</span>
            {studio.map(s => (
              <div key={s.label}>
                <div className={`fw-semibold ${s.alert ? 'text-danger' : ''}`}>{s.value}</div>
                <div className="small text-muted">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-xl-6">
          <SectionCard
            title="Recent Orders"
            icon="📋"
            flush
            actions={<Link to="/orders" className="btn btn-sm btn-outline-secondary">All orders</Link>}
          >
            {recentOrders.length === 0 ? (
              <EmptyState icon="📋" message="No orders yet" description="Create one from the Orders page, or just tell the assistant about it." />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map(order => (
                      <tr key={order.id}>
                        <td>
                          <Link to={`/orders/${order.id}`} className="fw-semibold">{order.id.slice(0, 6).toUpperCase()}</Link>
                        </td>
                        <td>{customerMap.get(order.customerId)?.name ?? '—'}</td>
                        <td className="text-muted">{formatDate(order.orderDate)}</td>
                        <td className="fw-semibold">{formatCurrency(order.grandTotal ?? order.total)}</td>
                        <td><StatusBadge status={order.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="col-12 col-xl-6">
          <SectionCard
            title="Recent Production"
            icon="🏭"
            flush
            actions={<Link to="/production" className="btn btn-sm btn-outline-secondary">Log production</Link>}
          >
            {recentProductions.length === 0 ? (
              <EmptyState icon="🏭" message="No production records yet" description="Log a run from the Production page to start tracking output." />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Batch</th>
                      <th>Product</th>
                      <th>Qty</th>
                      <th>Assigned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProductions.map(prod => (
                      <tr key={prod.id}>
                        <td className="text-muted">{formatDate(prod.productionDate)}</td>
                        <td className="font-monospace">{prod.batchCode || '—'}</td>
                        <td>{productMap.get(prod.productId)?.name ?? '—'}</td>
                        <td className="fw-semibold">{prod.actualQuantity ?? prod.quantity}</td>
                        <td className="small">{(prod.assignedWorkerNames ?? []).join(', ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <SectionCard
        title="Product Profitability"
        icon="📈"
        flush
        actions={<Link to="/reports" className="btn btn-sm btn-outline-secondary">Reports</Link>}
      >
        {topProfitable.length === 0 ? (
          <EmptyState icon="📈" message="No sales data yet" description="Profit shows up here once orders are completed." />
        ) : (
          <div className="table-responsive">
            <table className="table table-hover mb-0">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Units</th>
                  <th>Revenue</th>
                  <th>Profit</th>
                  <th>Margin</th>
                </tr>
              </thead>
              <tbody>
                {topProfitable.map(row => (
                  <tr key={row.productId}>
                    <td className="fw-semibold">{row.product}</td>
                    <td>{row.unitsSold}</td>
                    <td>{formatCurrency(row.revenue)}</td>
                    <td className="fw-semibold">{formatCurrency(row.profit)}</td>
                    <td>
                      <span className={`badge bg-${row.margin >= 30 ? 'success' : row.margin >= 10 ? 'warning' : 'danger'}`}>
                        {row.margin.toFixed(1)}%
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  )
}
