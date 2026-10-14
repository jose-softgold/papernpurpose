import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { buildMetrics, loadDashboardData, type DashboardData } from '../../services/dashboard'
import { formatCurrency } from '../../utils/format'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner } from '../../utils/roles'
import LoadingSpinner from '../../components/LoadingSpinner'
import PageHeader from '../../components/PageHeader'
import SectionCard from '../../components/SectionCard'
import StatusBadge from '../../components/StatusBadge'
import EmptyState from '../../components/EmptyState'
import {
  dayLabel, MaterialsCard, MoneySummary, OrderPipelineCard, PurchasesCard, TrendChart, WhoPaidCard,
} from '../../components/dashboard/DashboardSections'

export default function OccasionDashboard() {
  const { seasonId = '' } = useParams()
  const navigate = useNavigate()
  const { role } = useAuth()
  const showSpend = isAdminOrOwner(role)
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadDashboardData({ includeSpend: showSpend })
      .then(setData)
      .catch(err => console.error(err))
      .finally(() => setLoading(false))
  }, [showSpend])

  const season = data?.seasons.find(s => s.id === seasonId) ?? null
  const metrics = useMemo(() => (data && season ? buildMetrics(data, { seasonId }) : null), [data, season, seasonId])

  if (loading) return <LoadingSpinner />
  if (!data || !season || !metrics) {
    return (
      <EmptyState
        icon="🎉"
        message="Occasion not found"
        description="It may have been deleted. Pick another one from Reports → Occasions."
      />
    )
  }

  const seasonsSorted = [...data.seasons].sort((a, b) => b.year - a.year || a.name.localeCompare(b.name))

  return (
    <div>
      <PageHeader
        title={season.name}
        subtitle={`Purchases, production and sales tagged to ${season.name}`}
        icon="🎉"
        actions={
          <>
            <StatusBadge status={season.status} />
            <select
              className="form-select form-select-sm w-auto"
              value={season.id}
              onChange={e => navigate(`/occasions/${e.target.value}`)}
              aria-label="Switch occasion"
            >
              {seasonsSorted.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Link to="/reports?tab=occasions" className="btn btn-sm btn-outline-secondary">All occasions</Link>
          </>
        }
      />

      <MoneySummary money={metrics.money} showSpend={showSpend} />

      {showSpend && (
        <div className="row g-3 mb-3">
          <div className="col-12 col-xl-5"><WhoPaidCard whoPaid={metrics.whoPaid} /></div>
          <div className="col-12 col-xl-7">
            <MaterialsCard topMaterials={metrics.topMaterials} lowStock={metrics.lowStock} showSpend={showSpend} />
          </div>
        </div>
      )}

      {showSpend && (
        <div className="mb-3">
          <PurchasesCard rows={metrics.purchaseRows} title={`All bills (${metrics.purchaseRows.length})`} limit={Infinity} showItems />
        </div>
      )}

      <div className="row g-3 mb-3">
        <div className="col-12 col-xl-6">
          <SectionCard title={`Production batches (${metrics.batches.length})`} icon="🏭" flush>
            {metrics.batches.length === 0 ? (
              <EmptyState icon="🏭" message="No completed batches for this occasion" />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Batch</th>
                      <th>Product</th>
                      <th className="text-end">Qty</th>
                      <th className="text-end">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.batches.map(b => (
                      <tr key={b.id}>
                        <td className="small text-muted text-nowrap">{dayLabel(b.dateMs)}</td>
                        <td className="font-monospace small">{b.batchCode || '—'}</td>
                        <td>{b.product}</td>
                        <td className="text-end">{b.qty}</td>
                        <td className="text-end">{formatCurrency(b.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
        <div className="col-12 col-xl-6">
          <SectionCard title="Products sold" icon="🎀" flush>
            {metrics.productsSold.length === 0 ? (
              <EmptyState icon="🎀" message="No sales for this occasion yet" />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover mb-0">
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th className="text-end">Qty</th>
                      <th className="text-end">Revenue</th>
                      <th className="text-end">Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.productsSold.map(p => (
                      <tr key={p.key}>
                        <td>{p.name}</td>
                        <td className="text-end">{p.qty}</td>
                        <td className="text-end fw-semibold">{formatCurrency(p.amount)}</td>
                        <td className={`text-end ${p.profit < 0 ? 'text-danger' : ''}`}>{formatCurrency(p.profit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-xl-6"><OrderPipelineCard pipeline={metrics.pipeline} upcoming={metrics.upcoming} /></div>
        <div className="col-12 col-xl-6"><TrendChart trend={metrics.trend} showSpend={showSpend} /></div>
      </div>
    </div>
  )
}
