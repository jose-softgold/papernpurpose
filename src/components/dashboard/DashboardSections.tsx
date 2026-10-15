import { Link } from 'react-router-dom'
import type { DashboardMetrics, OccasionRow } from '../../services/dashboard'
import { formatCurrency, formatPercent } from '../../utils/format'
import SectionCard from '../SectionCard'
import StatCard from '../StatCard'
import StatusBadge from '../StatusBadge'
import EmptyState from '../EmptyState'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function dayLabel(ms: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

export function MoneySummary({ money, showSpend }: { money: DashboardMetrics['money']; showSpend: boolean }) {
  const cards = [
    ...(showSpend
      ? [
          { label: 'Purchases', value: formatCurrency(money.purchases), hint: `${money.bills} bill${money.bills === 1 ? '' : 's'}`, icon: '🛒', tone: 'amber' as const },
          {
            label: 'Due to suppliers',
            value: formatCurrency(money.due),
            hint: money.due > 0 ? `${formatCurrency(money.paid)} paid so far` : 'All bills settled',
            icon: '⏳',
            tone: 'coral' as const,
            alert: money.due > 0,
          },
        ]
      : []),
    { label: 'Sales (ex GST)', value: formatCurrency(money.revenue), hint: `${money.orders} order${money.orders === 1 ? '' : 's'}`, icon: '💵', tone: 'teal' as const },
    { label: 'Cost of goods', value: formatCurrency(money.cogs), icon: '🧾', tone: 'slate' as const },
    { label: 'Gross profit', value: formatCurrency(money.profit), hint: money.revenue > 0 ? `${formatPercent(money.margin)} margin` : undefined, icon: '📈', tone: 'violet' as const },
    ...(showSpend
      ? [{ label: 'Net after purchases', value: formatCurrency(money.net), icon: '⚖️', tone: 'coral' as const, alert: money.net < 0 }]
      : []),
  ]
  return (
    <div className="row g-3 mb-3">
      {cards.map(c => (
        <div className="col-6 col-md-4 col-xl" key={c.label}>
          <StatCard {...c} />
        </div>
      ))}
    </div>
  )
}

export function WhoPaidCard({ whoPaid }: { whoPaid: DashboardMetrics['whoPaid'] }) {
  return (
    <SectionCard title="Who paid" icon="👛" flush subtitle="Payments made towards purchase bills, per person">
      {whoPaid.length === 0 ? (
        <EmptyState icon="👛" message="No purchases in this period" />
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0 align-middle">
            <thead>
              <tr>
                <th>Person</th>
                <th className="text-end">Bills</th>
                <th className="text-end">Amount</th>
                <th style={{ width: '30%' }}>Share</th>
                <th>Last bill</th>
              </tr>
            </thead>
            <tbody>
              {whoPaid.map(p => (
                <tr key={p.key || p.name}>
                  <td className="fw-semibold">{p.name}</td>
                  <td className="text-end">{p.qty}</td>
                  <td className="text-end fw-semibold">{formatCurrency(p.amount)}</td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <div className="progress flex-grow-1" style={{ height: 6 }}>
                        <div className="progress-bar" style={{ width: `${p.share}%` }} />
                      </div>
                      <span className="small text-muted">{p.share.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="small text-muted">{dayLabel(p.lastBillMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  )
}

export function PurchasesCard({
  rows,
  title = 'Recent purchases',
  limit = 10,
  showItems = false,
}: {
  rows: DashboardMetrics['purchaseRows']
  title?: string
  limit?: number
  showItems?: boolean
}) {
  const shown = rows.slice(0, limit)
  return (
    <SectionCard
      title={title}
      icon="🛒"
      flush
      actions={<Link to="/purchases" className="btn btn-sm btn-outline-secondary">Purchases</Link>}
    >
      {shown.length === 0 ? (
        <EmptyState icon="🛒" message="No purchases in this period" />
      ) : (
        <div className="table-responsive">
          <table className="table table-hover mb-0 align-middle">
            <thead>
              <tr>
                <th>Date</th>
                <th>Supplier</th>
                <th>Paid by</th>
                {showItems ? <th>Items</th> : <th>Occasion</th>}
                <th className="text-end">Amount</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(r => (
                <tr key={r.id}>
                  <td className="small text-muted text-nowrap">{dayLabel(r.dateMs)}</td>
                  <td>{r.supplier}</td>
                  <td>{r.paidBy || '—'}</td>
                  {showItems ? <td className="small">{r.items || '—'}</td> : <td className="small">{r.occasion || '—'}</td>}
                  <td className="text-end">
                    <div className="fw-semibold">{formatCurrency(r.amount)}</div>
                    {r.balance > 0 && <div className="small text-danger">{formatCurrency(r.balance)} due</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > shown.length && (
            <div className="small text-muted px-3 py-2">Showing {shown.length} of {rows.length} bills</div>
          )}
        </div>
      )}
    </SectionCard>
  )
}

export function MaterialsCard({
  topMaterials,
  lowStock,
  showSpend,
}: {
  topMaterials: DashboardMetrics['topMaterials']
  lowStock: DashboardMetrics['lowStock']
  showSpend: boolean
}) {
  return (
    <SectionCard
      title="Materials"
      icon="📦"
      actions={<Link to="/materials" className="btn btn-sm btn-outline-secondary">Materials</Link>}
    >
      <div className="row g-3">
        {showSpend && (
          <div className="col-md-6">
            <div className="small fw-semibold mb-2">Top bought</div>
            {topMaterials.length === 0 ? (
              <div className="small text-muted">Nothing bought in this period.</div>
            ) : (
              <ul className="list-unstyled small mb-0">
                {topMaterials.map(m => (
                  <li key={m.key} className="d-flex justify-content-between gap-2 py-1 border-bottom">
                    <span>{m.name} <span className="text-muted">× {m.qty}</span></span>
                    <span className="fw-semibold">{formatCurrency(m.amount)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className={showSpend ? 'col-md-6' : 'col-12'}>
          <div className="small fw-semibold mb-2">Low stock</div>
          {lowStock.length === 0 ? (
            <div className="small text-muted">All materials are above their minimum.</div>
          ) : (
            <ul className="list-unstyled small mb-0">
              {lowStock.slice(0, 8).map(m => (
                <li key={m.id} className="d-flex justify-content-between gap-2 py-1 border-bottom">
                  <span>{m.name}</span>
                  <span>
                    <span className="text-danger fw-semibold">{m.stock}</span>
                    <span className="text-muted"> / {m.minimum} {m.unit}</span>
                  </span>
                </li>
              ))}
              {lowStock.length > 8 && <li className="text-muted pt-1">+{lowStock.length - 8} more</li>}
            </ul>
          )}
        </div>
      </div>
    </SectionCard>
  )
}

export function OccasionCards({ rows, showSpend }: { rows: OccasionRow[]; showSpend: boolean }) {
  const live = rows.filter(r => r.status === 'active' || r.status === 'upcoming')
  if (live.length === 0) return null
  return (
    <div className="mb-3">
      <div className="d-flex align-items-center justify-content-between mb-2">
        <h6 className="mb-0">🎉 Occasions</h6>
        <Link to="/reports?tab=occasions" className="small">All occasions</Link>
      </div>
      <div className="row g-3">
        {live.map(r => (
          <div className="col-12 col-md-6 col-xl-4" key={r.key}>
            <Link to={`/occasions/${r.key}`} className="card h-100 text-decoration-none text-reset">
              <div className="card-body">
                <div className="d-flex justify-content-between align-items-start mb-2">
                  <div className="fw-semibold">{r.name}</div>
                  <StatusBadge status={r.status} />
                </div>
                <div className="row g-2 small">
                  {showSpend && (
                    <div className="col-6">
                      <div className="text-muted">Spent</div>
                      <div className="fw-semibold">{formatCurrency(r.purchases)}</div>
                    </div>
                  )}
                  <div className="col-6">
                    <div className="text-muted">Produced</div>
                    <div className="fw-semibold">{r.productionQty}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted">Sold</div>
                    <div className="fw-semibold">{r.unitsSold} · {formatCurrency(r.revenue)}</div>
                  </div>
                  <div className="col-6">
                    <div className="text-muted">Profit</div>
                    <div className={`fw-semibold ${r.profit < 0 ? 'text-danger' : ''}`}>{formatCurrency(r.profit)}</div>
                  </div>
                </div>
                {showSpend && r.payers[0] && (
                  <div className="small text-muted mt-2">
                    Top payer: <span className="text-body">{r.payers[0].name}</span> ({formatCurrency(r.payers[0].amount)})
                  </div>
                )}
              </div>
            </Link>
          </div>
        ))}
      </div>
    </div>
  )
}

export function TrendChart({ trend, showSpend }: { trend: DashboardMetrics['trend']; showSpend: boolean }) {
  const max = Math.max(1, ...trend.map(t => Math.max(showSpend ? t.purchases : 0, t.sales)))
  const W = 720
  const H = 200
  const pad = { top: 10, bottom: 24, left: 4, right: 4 }
  const slot = (W - pad.left - pad.right) / trend.length
  const barW = Math.max(4, (slot - 8) / (showSpend ? 2 : 1))
  const h = (v: number) => ((H - pad.top - pad.bottom) * v) / max
  const empty = trend.every(t => !t.sales && !(showSpend && t.purchases))
  return (
    <SectionCard
      title="Last 12 months"
      icon="📊"
      actions={
        <div className="d-flex gap-3 small">
          {showSpend && <span><span className="d-inline-block rounded me-1" style={{ width: 10, height: 10, background: 'var(--bs-warning)' }} />Purchases</span>}
          <span><span className="d-inline-block rounded me-1" style={{ width: 10, height: 10, background: 'var(--bs-primary)' }} />Sales</span>
        </div>
      }
    >
      {empty ? (
        <div className="small text-muted">No purchases or sales in the last 12 months.</div>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Purchases and sales by month">
          <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="var(--bs-border-color)" />
          {trend.map((t, i) => {
            const x0 = pad.left + i * slot + 4
            const base = H - pad.bottom
            return (
              <g key={i}>
                {showSpend && (
                  <rect x={x0} y={base - h(t.purchases)} width={barW} height={h(t.purchases)} fill="var(--bs-warning)" rx={2}>
                    <title>{`${t.label} purchases: ${formatCurrency(t.purchases)}`}</title>
                  </rect>
                )}
                <rect x={x0 + (showSpend ? barW : 0)} y={base - h(t.sales)} width={barW} height={h(t.sales)} fill="var(--bs-primary)" rx={2}>
                  <title>{`${t.label} sales: ${formatCurrency(t.sales)}`}</title>
                </rect>
                <text x={pad.left + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--bs-secondary-color)">
                  {t.label}
                </text>
              </g>
            )
          })}
        </svg>
      )}
    </SectionCard>
  )
}

export function OrderPipelineCard({ pipeline, upcoming }: { pipeline: DashboardMetrics['pipeline']; upcoming: DashboardMetrics['upcoming'] }) {
  return (
    <SectionCard
      title="Orders pipeline"
      icon="📋"
      actions={<Link to="/orders" className="btn btn-sm btn-outline-secondary">Orders</Link>}
    >
      {pipeline.length === 0 ? (
        <div className="small text-muted">No orders yet.</div>
      ) : (
        <div className="d-flex flex-wrap gap-2 mb-3">
          {pipeline.map(p => (
            <div key={p.status} className="border rounded px-2 py-1 small">
              <StatusBadge status={p.status} className="me-1" />
              <span className="fw-semibold">{p.count}</span>
              <span className="text-muted"> · {formatCurrency(p.value)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="small fw-semibold mb-2">Upcoming events</div>
      {upcoming.length === 0 ? (
        <div className="small text-muted">No upcoming event dates.</div>
      ) : (
        <ul className="list-unstyled small mb-0">
          {upcoming.map(u => (
            <li key={u.id} className="d-flex justify-content-between gap-2 py-1 border-bottom">
              <span>
                <Link to={`/orders/${u.id}`}>{dayLabel(u.eventMs)}</Link>
                <span className="ms-2">{u.customer}</span>
                {u.eventType && <span className="text-muted"> · {u.eventType}</span>}
              </span>
              <span className="text-nowrap">
                <StatusBadge status={u.status} className="me-1" />
                {formatCurrency(u.value)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </SectionCard>
  )
}
