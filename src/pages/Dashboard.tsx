import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { customerService } from '../services/customers'
import { productService } from '../services/products'
import { materialService } from '../services/materials'
import { orderService } from '../services/orders'
import { productionService } from '../services/production'
import { inventoryService } from '../services/inventory'
import { reportService, ProductProfitabilityRow } from '../services/reports'
import { Customer, Product, ProductVersion, Material, Order, Production } from '../types'
import { formatCurrency, formatDate } from '../utils/format'
import LoadingSpinner from '../components/LoadingSpinner'

const ORDER_STATUS_COLORS: Record<string, string> = {
  DRAFT: 'secondary',
  QUOTED: 'info',
  CONFIRMED: 'primary',
  IN_PRODUCTION: 'warning',
  READY: 'success',
  DELIVERED: 'success',
  COMPLETED: 'dark',
  CANCELLED: 'danger',
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)

  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [versions, setVersions] = useState<ProductVersion[]>([])
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
      productService.getAllVersions(),
      materialService.getAll(),
      orderService.getAll(),
      productionService.getAll(),
      inventoryService.getMaterialStocks(),
      inventoryService.getProductStocks(),
      reportService.getProductProfitability(),
    ]).then(([c, p, v, m, o, pr, ms, ps, prof]) => {
      setCustomers(c)
      setProducts(p)
      setVersions(v)
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
  const versionMap = new Map(versions.map(v => [v.id, v]))
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

  return (
    <div className="container-fluid py-3">
      <h4 className="mb-4">Dashboard</h4>

      {/* Row 1 — Stat cards */}
      <div className="row g-3 mb-4">
        <div className="col-md-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="fs-2 fw-bold">{activeCustomers}</div>
              <div className="text-muted small">Total Customers</div>
            </div>
          </div>
        </div>

        <div className="col-md-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="fs-2 fw-bold">{activeProducts}</div>
              <div className="text-muted small">Total Products</div>
            </div>
          </div>
        </div>

        <div className="col-md-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="fs-2 fw-bold">{openOrders}</div>
              <div className="text-muted small">Open Orders</div>
            </div>
          </div>
        </div>

        <div className="col-md-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="fs-2 fw-bold" style={{ fontSize: '1.4rem' }}>{formatCurrency(rawMaterialStockValue)}</div>
              <div className="text-muted small">Raw Material Stock Value</div>
            </div>
          </div>
        </div>

        <div className="col-md-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className="fs-2 fw-bold">{finishedProductUnits}</div>
              <div className="text-muted small">Finished Product Units</div>
            </div>
          </div>
        </div>

        <div className="col-md-2">
          <div className="card h-100">
            <div className="card-body text-center">
              <div className={`fs-2 fw-bold ${lowStockCount > 0 ? 'text-danger' : ''}`}>{lowStockCount}</div>
              <div className="text-muted small">Low Stock Items</div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 2 — Recent Orders + Recent Production */}
      <div className="row g-3 mb-4">
        <div className="col-md-6">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Recent Orders</h5>
              <div className="table-responsive">
                <table className="table table-sm table-hover">
                  <thead>
                    <tr>
                      <th>Order ID</th>
                      <th>Customer</th>
                      <th>Date</th>
                      <th>Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentOrders.length === 0 ? (
                      <tr><td colSpan={5} className="text-center text-muted">No orders yet</td></tr>
                    ) : recentOrders.map(order => (
                      <tr key={order.id}>
                        <td>
                          <Link to={`/orders/${order.id}`}>
                            {order.id.slice(0, 6).toUpperCase()}
                          </Link>
                        </td>
                        <td>{customerMap.get(order.customerId)?.name ?? '—'}</td>
                        <td>{formatDate(order.orderDate)}</td>
                        <td>{formatCurrency(order.total)}</td>
                        <td>
                          <span className={`badge bg-${ORDER_STATUS_COLORS[order.status] ?? 'secondary'}`}>
                            {order.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Recent Production</h5>
              <div className="table-responsive">
                <table className="table table-sm table-hover">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Product</th>
                      <th>Version</th>
                      <th>Qty</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProductions.length === 0 ? (
                      <tr><td colSpan={4} className="text-center text-muted">No production records yet</td></tr>
                    ) : recentProductions.map(prod => (
                      <tr key={prod.id}>
                        <td>{formatDate(prod.productionDate)}</td>
                        <td>{productMap.get(prod.productId)?.name ?? '—'}</td>
                        <td>{versionMap.get(prod.productVersionId)?.version ?? '—'}</td>
                        <td>{prod.quantity}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Row 3 — Low Stock + Profitability */}
      <div className="row g-3">
        <div className="col-md-6">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Low Stock Materials</h5>
              {lowStockMaterials.length === 0 ? (
                <p className="text-muted text-center mt-3">All materials are well stocked</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Material</th>
                        <th>Current Stock</th>
                        <th>Unit</th>
                        <th>Minimum Stock</th>
                      </tr>
                    </thead>
                    <tbody>
                      {lowStockMaterials.map(m => (
                        <tr key={m.id} className="text-danger">
                          <td>{m.name}</td>
                          <td>{materialStocks[m.id] ?? 0}</td>
                          <td>{m.unit}</td>
                          <td>{m.minimumStock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <div className="card h-100">
            <div className="card-body">
              <h5 className="card-title">Product Profitability</h5>
              {topProfitable.length === 0 ? (
                <p className="text-muted text-center mt-3">No sales data yet</p>
              ) : (
                <div className="table-responsive">
                  <table className="table table-sm">
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>Units Sold</th>
                        <th>Revenue</th>
                        <th>Profit</th>
                        <th>Margin</th>
                      </tr>
                    </thead>
                    <tbody>
                      {topProfitable.map(row => (
                        <tr key={row.productId}>
                          <td>{row.product}</td>
                          <td>{row.unitsSold}</td>
                          <td>{formatCurrency(row.revenue)}</td>
                          <td>{formatCurrency(row.profit)}</td>
                          <td>{row.margin.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
