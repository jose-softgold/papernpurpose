import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { customerService } from '../services/customers'
import { productService } from '../services/products'
import { materialService } from '../services/materials'
import { orderService } from '../services/orders'
import { productionService } from '../services/production'
import { inventoryService } from '../services/inventory'
import { reportService, ProductProfitabilityRow } from '../services/reports'
import { Customer, Product, Material, Order, Production } from '../types'
import { formatCurrency, formatDate } from '../utils/format'
import LoadingSpinner from '../components/LoadingSpinner'
import PageHeader from '../components/PageHeader'
import SectionCard from '../components/SectionCard'
import StatCard from '../components/StatCard'
import StatusBadge from '../components/StatusBadge'
import EmptyState from '../components/EmptyState'

export default function Dashboard() {
  const [loading, setLoading] = useState(true)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const [productions, setProductions] = useState<Production[]>([])
  const [materialStocks, setMaterialStocks] = useState<Record<string, number>>({})
  const [productStocks, setProductStocks] = useState<Record<string, number>>({})
  const [profitability, setProfitability] = useState<ProductProfitabilityRow[]>([])

  useEffect(() => {
    Promise.all([
      customerService.getAll(),
      productService.getAll(),
      materialService.getAll(),
      orderService.getAll(),
      productionService.getAll(),
      inventoryService.getMaterialStocks(),
      inventoryService.getProductStocks(),
      reportService.getProductProfitability(),
    ]).then(([c, p, m, o, pr, ms, ps, prof]) => {
      setCustomers(c)
      setProducts(p)
      setMaterials(m)
      setOrders(o)
      setProductions(pr)
      setMaterialStocks(ms)
      setProductStocks(ps)
      setProfitability(prof)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  if (loading) return <LoadingSpinner />

  // Lookup maps
  const productMap = new Map(products.map(p => [p.id, p]))
  const customerMap = new Map(customers.map(c => [c.id, c]))

  // Stat card computations
  const activeCustomers = customers.filter(c => c.status === 'active').length
  const activeProducts = products.filter(p => p.status === 'active').length
  const openOrders = orders.filter(o => o.status !== 'COMPLETED' && o.status !== 'CANCELLED').length

  const rawMaterialStockValue = materials.reduce((sum, m) => {
    const stock = materialStocks[m.id] ?? 0
    return sum + stock * m.costPerUnit
  }, 0)

  const finishedProductUnits = Object.values(productStocks).reduce((sum, qty) => sum + qty, 0)

  const lowStockMaterials = materials.filter(m => (materialStocks[m.id] ?? 0) < m.minimumStock)
  const lowStockCount = lowStockMaterials.length

  // Recent orders: last 5 (already sorted desc by orderDate from getAll)
  const recentOrders = orders.slice(0, 5)

  // Recent productions: last 5 sorted desc by productionDate
  const recentProductions = [...productions]
    .sort((a, b) => b.productionDate.toMillis() - a.productionDate.toMillis())
    .slice(0, 5)

  // Top 5 by profit
  const topProfitable = [...profitability]
    .sort((a, b) => b.profit - a.profit)
    .slice(0, 5)

  const stats = [
    { label: 'Active Customers', value: activeCustomers, icon: '👥', tone: 'violet' as const },
    { label: 'Active Products', value: activeProducts, icon: '🎀', tone: 'coral' as const },
    { label: 'Open Orders', value: openOrders, icon: '📋', tone: 'teal' as const },
    {
      label: 'Raw Material Stock Value',
      value: formatCurrency(rawMaterialStockValue),
      icon: '💰',
      tone: 'amber' as const,
    },
    { label: 'Finished Units', value: finishedProductUnits, icon: '🗄️', tone: 'slate' as const },
    {
      label: 'Low Stock Items',
      value: lowStockCount,
      icon: '⚠️',
      tone: 'coral' as const,
      alert: lowStockCount > 0,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="A snapshot of your studio right now"
        icon="📊"
        actions={
          <>
            <Link to="/" className="btn btn-sm btn-primary">
              🤖 Ask the AI
            </Link>
            <Link to="/orders" className="btn btn-sm btn-outline-secondary">
              View orders
            </Link>
          </>
        }
      />

      <div className="row g-3 mb-3">
        {stats.map(s => (
          <div className="col-6 col-md-4 col-xl-2" key={s.label}>
            <StatCard
              label={s.label}
              value={s.value}
              icon={s.icon}
              tone={s.tone}
              alert={s.alert}
            />
          </div>
        ))}
      </div>

      <div className="row g-3 mb-3">
        <div className="col-12 col-xl-6">
          <SectionCard
            title="Recent Orders"
            icon="📋"
            flush
            actions={
              <Link to="/orders" className="btn btn-sm btn-outline-secondary">
                All orders
              </Link>
            }
          >
            {recentOrders.length === 0 ? (
              <EmptyState
                icon="📋"
                message="No orders yet"
                description="Create one from the Orders page, or just tell the assistant about it."
              />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Assigned</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.map(order => (
                      <tr key={order.id}>
                        <td>
                          <Link to={`/orders/${order.id}`} className="fw-semibold">
                            {order.id.slice(0, 6).toUpperCase()}
                          </Link>
                        </td>
                        <td>{customerMap.get(order.customerId)?.name ?? '—'}</td>
                        <td className="text-muted">{formatDate(order.orderDate)}</td>
                        <td className="small">{(order.assignedWorkerNames ?? []).join(', ') || '—'}</td>
                        <td className="fw-semibold">{formatCurrency(order.grandTotal ?? order.total)}</td>
                        <td>
                          <StatusBadge status={order.status} />
                        </td>
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
            actions={
              <Link to="/production" className="btn btn-sm btn-outline-secondary">
                Log production
              </Link>
            }
          >
            {recentProductions.length === 0 ? (
              <EmptyState
                icon="🏭"
                message="No production records yet"
                description="Log a run from the Production page to start tracking output."
              />
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

      <div className="row g-3">
        <div className="col-12 col-xl-6">
          <SectionCard
            title="Low Stock Materials"
            icon="⚠️"
            flush
            actions={
              <Link to="/materials" className="btn btn-sm btn-outline-secondary">
                Materials
              </Link>
            }
          >
            {lowStockMaterials.length === 0 ? (
              <EmptyState
                icon="✅"
                message="All materials are well stocked"
                description="Nothing has dropped below its minimum level."
              />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th>Current</th>
                      <th>Unit</th>
                      <th>Minimum</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lowStockMaterials.map(m => (
                      <tr key={m.id}>
                        <td className="fw-semibold">{m.name}</td>
                        <td className="text-danger fw-semibold">{materialStocks[m.id] ?? 0}</td>
                        <td className="text-muted">{m.unit}</td>
                        <td className="text-muted">{m.minimumStock}</td>
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
            title="Product Profitability"
            icon="📈"
            flush
            actions={
              <Link to="/reports" className="btn btn-sm btn-outline-secondary">
                Reports
              </Link>
            }
          >
            {topProfitable.length === 0 ? (
              <EmptyState
                icon="📈"
                message="No sales data yet"
                description="Profit shows up here once orders are completed."
              />
            ) : (
              <div className="table-responsive">
                <table className="table table-hover">
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
                          <span
                            className={`badge bg-${row.margin >= 30 ? 'success' : row.margin >= 10 ? 'warning' : 'danger'}`}
                          >
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
      </div>
    </div>
  )
}
