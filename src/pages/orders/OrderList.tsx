import React, { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { isWorker as roleIsWorker, canWriteMaster } from '../../utils/roles'
import { Timestamp } from 'firebase/firestore'
import { orderService } from '../../services/orders'
import { productService } from '../../services/products'
import { customerService } from '../../services/customers'
import { productionService } from '../../services/production'
import { inventoryService } from '../../services/inventory'
import { occasionService } from '../../services/occasions'
import { Order, OrderStatus, Customer, Product, ProductVersion, Production, Occasion, OccasionSeason } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import StatusBadge from '../../components/StatusBadge'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency, formatDate } from '../../utils/format'
import { exportToCSV } from '../../utils/export'
import { lineTax } from '../../utils/tax'
import EntityQuickCreate from '../../components/EntityQuickCreate'
import QuickSelect from '../../components/QuickSelect'

const ALL_STATUSES: OrderStatus[] = ['DRAFT', 'QUOTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED']

const nowStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

interface LineItem {
  productId: string
  productVersionId: string
  quantity: string
  unitPrice: string
  costPerUnit: string
  gstRate: string
  occasionSeasonId: string
}

const emptyLine = (): LineItem => ({
  productId: '',
  productVersionId: '',
  quantity: '1',
  unitPrice: '',
  costPerUnit: '',
  gstRate: '0',
  occasionSeasonId: '',
})

interface NewOrderForm {
  customerId: string
  orderDate: string
  eventDate: string
  eventType: string
  occasionId: string
  discount: string
  notes: string
}

const emptyForm = (): NewOrderForm => ({
  customerId: '',
  orderDate: nowStr(),
  eventDate: '',
  eventType: '',
  occasionId: '',
  discount: '0',
  notes: '',
})

interface OrderRow extends Order {
  customerName: string
}

export default function OrderList() {
  const navigate = useNavigate()
  const { toasts, showToast } = useToast()
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL')
  const [showModal, setShowModal] = useState(false)
  const [step, setStep] = useState<1 | 2>(1)
  const [saving, setSaving] = useState(false)

  // Reference data for modal
  const [customers, setCustomers] = useState<Customer[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [allVersions, setAllVersions] = useState<ProductVersion[]>([])
  const [allProductions, setAllProductions] = useState<Production[]>([])
  const [productStocks, setProductStocks] = useState<Record<string, number>>({})
  const [occasions, setOccasions] = useState<Occasion[]>([])
  const [seasons, setSeasons] = useState<OccasionSeason[]>([])

  // Form state
  const [form, setForm] = useState<NewOrderForm>(emptyForm())
  const [lines, setLines] = useState<LineItem[]>([emptyLine()])

  const { role, user } = useAuth()
  const isWorker = roleIsWorker(role)
  const canMaster = canWriteMaster(role)
  const [showCustomerCreate, setShowCustomerCreate] = useState(false)
  const [myWorkOnly, setMyWorkOnly] = useState(false)
  const WORKER_VISIBLE: OrderStatus[] = ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED']

  const load = async () => {
    if (isWorker && !user?.uid) return
    setLoading(true)
    try {
      const [orders, customers] = await Promise.all([
        orderService.getAll(isWorker ? WORKER_VISIBLE : undefined, isWorker && user ? user.uid : undefined),
        isWorker ? Promise.resolve([]) : customerService.getAll(),
      ])
      const custMap = Object.fromEntries(customers.map(c => [c.id, c.name]))
      setRows(orders.map(o => ({ ...o, customerName: custMap[o.customerId] ?? '' })))
    } catch {
      showToast('Failed to load orders', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [isWorker, user?.uid])

  const openModal = async () => {
    setForm(emptyForm())
    setLines([emptyLine()])
    setStep(1)
    setShowModal(true)
    try {
      const [custs, prods, versions, prods2, stocks, occs, seas] = await Promise.all([
        customerService.getAll(),
        productService.getAll(),
        productService.getAllVersions(),
        productionService.getAll(),
        inventoryService.getProductStocks(),
        occasionService.getActiveOccasions(),
        occasionService.getAllSeasons(),
      ])
      setCustomers(custs)
      setProducts(prods)
      setAllVersions(versions)
      setAllProductions(prods2)
      setProductStocks(stocks)
      setOccasions(occs)
      setSeasons(seas.filter(s => s.status === 'active'))
    } catch {
      showToast('Failed to load reference data', 'danger')
    }
  }

  const setField = (field: keyof NewOrderForm) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const versionsFor = (productId: string) =>
    allVersions.filter(v => v.productId === productId && v.status === 'active')

  const latestCostFor = (productId: string): number => {
    const runs = allProductions.filter(p => p.productId === productId && p.status === 'COMPLETED')
    if (runs.length === 0) return 0
    runs.sort((a, b) => {
      const ta = a.productionDate?.toMillis?.() ?? 0
      const tb = b.productionDate?.toMillis?.() ?? 0
      return tb - ta
    })
    return runs[0].costPerUnit
  }

  const seasonsForOccasion = (occasionId: string) =>
    seasons.filter(s => s.occasionId === occasionId)

  const defaultSeasonForOccasion = (occasionId: string): string => {
    const year = new Date().getFullYear()
    const match = seasonsForOccasion(occasionId).find(s => s.year === year)
    return match?.id ?? seasonsForOccasion(occasionId)[0]?.id ?? ''
  }

  const handleOccasionChange = (occasionId: string) => {
    const occ = occasions.find(o => o.id === occasionId)
    setForm(f => ({
      ...f,
      occasionId,
      eventType: occ?.name ?? '',
    }))
    const seasonId = occasionId ? defaultSeasonForOccasion(occasionId) : ''
    setLines(prev => prev.map(l => ({ ...l, occasionSeasonId: seasonId })))
  }

  const updateLine = (i: number, field: keyof LineItem, value: string) => {
    setLines(prev => {
      const next = [...prev]
      next[i] = { ...next[i], [field]: value }
      if (field === 'productId') {
        // auto-fill version, unit price, cost
        const prod = products.find(p => p.id === value)
        const vers = versionsFor(value)
        next[i].productVersionId = vers[0]?.id ?? ''
        next[i].unitPrice = prod ? String(prod.defaultSellingPrice) : ''
        next[i].costPerUnit = String(latestCostFor(value))
        next[i].gstRate = String(prod?.gstRate ?? 0)
      }
      return next
    })
  }

  const addLine = () => setLines(prev => [...prev, emptyLine()])
  const removeLine = (i: number) => setLines(prev => prev.filter((_, idx) => idx !== i))

  const subtotal = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.unitPrice) || 0), 0)
  const gstTotal = lines.reduce((s, l) => s + lineTax(parseFloat(l.quantity) || 0, parseFloat(l.unitPrice) || 0, parseFloat(l.gstRate) || 0).gstAmount, 0)
  const discountAmt = parseFloat(form.discount) || 0
  const total = subtotal + gstTotal - discountAmt

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const validLines = lines.filter(l => l.productId && l.productVersionId && parseFloat(l.quantity) > 0)
    if (validLines.length === 0) {
      showToast('Add at least one line item', 'warning')
      return
    }
    setSaving(true)
    try {
      const toTs = (s: string): Timestamp => Timestamp.fromDate(new Date(s))
      const id = await orderService.create({
        customerId: form.customerId,
        orderDate: toTs(form.orderDate),
        eventDate: form.eventDate ? toTs(form.eventDate) : null,
        eventType: form.eventType.trim(),
        occasionId: form.occasionId || null,
        discount: parseFloat(form.discount) || 0,
        notes: form.notes.trim(),
        items: validLines.map(l => ({
          productId: l.productId,
          productVersionId: l.productVersionId,
          quantity: parseFloat(l.quantity),
          unitPrice: parseFloat(l.unitPrice) || 0,
          costPerUnit: parseFloat(l.costPerUnit) || 0,
          gstRate: parseFloat(l.gstRate) || 0,
          occasionSeasonId: l.occasionSeasonId || null,
        })),
      })
      showToast('Order created')
      setShowModal(false)
      await load()
      navigate(`/orders/${id}`)
    } catch {
      showToast('Failed to create order', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleExport = () => {
    const data = filtered.map(r => ({
      'Order ID': r.id.slice(0, 6),
      Customer: r.customerName,
      'Order Date': formatDate(r.orderDate),
      'Event Type': r.eventType || '—',
      'Total (₹)': r.total,
      Status: r.status,
    }))
    exportToCSV(data as unknown as Record<string, unknown>[], 'orders')
  }

  const filtered = (statusFilter === 'ALL' ? rows : rows.filter(r => r.status === statusFilter))
    .filter(r => {
      if (isWorker) return !!user && (r.assignedWorkerIds ?? []).includes(user.uid)
      if (!myWorkOnly || !user) return true
      return (r.assignedWorkerIds ?? []).includes(user.uid)
    })

  if (loading) return <LoadingSpinner />

  return (
    <div>
      <ToastContainer toasts={toasts} />

      <PageHeader
        title={isWorker ? 'Assigned to me' : 'Orders'}
        subtitle={
          isWorker
            ? (filtered.length ? `${filtered.length} assigned order${filtered.length === 1 ? '' : 's'}` : 'Orders assigned to you')
            : `${filtered.length} shown${statusFilter === 'ALL' ? '' : ` · filtered by ${statusFilter.replace('_', ' ')}`}`
        }
        icon="📋"
        actions={
          <>
            <select className="form-select form-select-sm" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'ALL' | OrderStatus)}>
              <option value="ALL">All Statuses</option>
              {(isWorker ? WORKER_VISIBLE : ALL_STATUSES).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            {!isWorker && (
              <label className="form-check mb-0 small">
                <input className="form-check-input" type="checkbox" checked={myWorkOnly} onChange={e => setMyWorkOnly(e.target.checked)} />
                <span className="form-check-label">My work</span>
              </label>
            )}
            {!isWorker && <button className="btn btn-outline-secondary btn-sm" onClick={handleExport}>Export CSV</button>}
            {canMaster && <Link to="/import?type=orders" className="btn btn-outline-secondary btn-sm">Bulk import</Link>}
            {!isWorker && <button className="btn btn-primary btn-sm" onClick={openModal}>+ New Order</button>}
          </>
        }
      />

        <div className="card">
          <DataGrid
            items={filtered}
            resetKey={`${statusFilter}:${myWorkOnly}`}
            empty={
              <EmptyState
                icon="📋"
                message={isWorker ? 'Nothing assigned yet' : 'No orders found'}
                description={
                  isWorker
                    ? (statusFilter === 'ALL'
                      ? 'When an admin assigns you to an order, it will show up here.'
                      : 'No assigned orders have this status right now.')
                    : statusFilter === 'ALL'
                      ? 'Create an order, or ask the assistant to log one for you.'
                      : 'No orders have this status right now.'
                }
              />
            }
          >
            {pageItems => (
              <>
                <thead>
                  <tr>
                    <th>Order ID</th>
                    {!isWorker && <th>Customer</th>}
                    <th>Order Date</th>
                    <th>Event Type</th>
                    <th>Assigned</th>
                    {!isWorker && <th>Total</th>}
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pageItems.map(r => (
                    <tr key={r.id} style={{ cursor: 'pointer' }} onClick={() => navigate(`/orders/${r.id}`)}>
                      <td className="fw-semibold font-monospace">{r.id.slice(0, 6).toUpperCase()}</td>
                      {!isWorker && <td>{r.customerName || '—'}</td>}
                      <td className="text-muted">{formatDate(r.orderDate)}</td>
                      <td>{r.eventType || '—'}</td>
                      <td className="small">{(r.assignedWorkerNames ?? []).join(', ') || '—'}</td>
                      {!isWorker && <td className="fw-semibold">{formatCurrency(r.grandTotal ?? r.total)}</td>}
                      <td>
                        <StatusBadge status={r.status} />
                      </td>
                      <td onClick={e => e.stopPropagation()}>
                        <button className="btn btn-outline-primary btn-sm" onClick={() => navigate(`/orders/${r.id}`)}>
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </DataGrid>
        </div>

      {/* New Order Modal */}
      {showModal && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog modal-xl modal-dialog-scrollable">
              <div className="modal-content">
                <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2) } : handleSubmit}>
                  <div className="modal-header">
                    <h5 className="modal-title">New Order — Step {step} of 2</h5>
                    <button type="button" className="btn-close" onClick={() => setShowModal(false)} />
                  </div>
                  <div className="modal-body">
                    {step === 1 && (
                      <div className="row g-3">
                        <div className="col-md-6">
                          <QuickSelect
                            label="Customer"
                            required
                            value={form.customerId}
                            onChange={id => setForm(f => ({ ...f, customerId: id }))}
                            placeholder="— Select Customer —"
                            options={customers.map(c => ({ id: c.id, label: c.name }))}
                            onAdd={() => setShowCustomerCreate(true)}
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Occasion</label>
                          <select
                            className="form-select"
                            value={form.occasionId}
                            onChange={e => handleOccasionChange(e.target.value)}
                          >
                            <option value="">— Select or type below —</option>
                            {occasions.map(o => (
                              <option key={o.id} value={o.id}>{o.name}</option>
                            ))}
                          </select>
                          <input
                            className="form-control mt-2"
                            value={form.eventType}
                            onChange={setField('eventType')}
                            placeholder="Event label (auto-filled from occasion)"
                          />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Order Date <span className="text-danger">*</span></label>
                          <input type="datetime-local" className="form-control" value={form.orderDate} onChange={setField('orderDate')} required />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Event Date</label>
                          <input type="datetime-local" className="form-control" value={form.eventDate} onChange={setField('eventDate')} />
                        </div>
                        <div className="col-md-6">
                          <label className="form-label">Discount (₹)</label>
                          <input type="number" min="0" step="0.01" className="form-control" value={form.discount} onChange={setField('discount')} />
                        </div>
                        <div className="col-12">
                          <label className="form-label">Notes</label>
                          <textarea className="form-control" rows={2} value={form.notes} onChange={setField('notes')} />
                        </div>
                      </div>
                    )}

                    {step === 2 && (
                      <>
                        <div className="table-responsive">
                          <table className="table table-sm align-middle">
                            <thead className="table-light">
                              <tr>
                                <th>Product</th>
                                <th>Version</th>
                                <th style={{ width: 80 }}>Qty</th>
                                <th>Season</th>
                                <th style={{ width: 110 }}>Unit Price</th>
                                <th style={{ width: 90 }}>GST</th>
                                <th style={{ width: 100 }}>Cost/Unit</th>
                                <th style={{ width: 100 }}>Line</th>
                                <th></th>
                              </tr>
                            </thead>
                            <tbody>
                              {lines.map((line, i) => {
                                const tax = lineTax(parseFloat(line.quantity) || 0, parseFloat(line.unitPrice) || 0, parseFloat(line.gstRate) || 0)
                                const vers = versionsFor(line.productId)
                                const prod = products.find(p => p.id === line.productId)
                                const stock = line.productId ? (productStocks[line.productId] ?? 0) : null
                                const qty = parseFloat(line.quantity) || 0
                                const needToProduce = stock !== null ? Math.max(0, qty - stock) : 0
                                return (
                                  <React.Fragment key={i}>
                                  <tr>
                                    <td>
                                      <select
                                        className="form-select form-select-sm"
                                        value={line.productId}
                                        onChange={e => updateLine(i, 'productId', e.target.value)}
                                        required
                                      >
                                        <option value="">— Product —</option>
                                        {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                      </select>
                                    </td>
                                    <td>
                                      <select
                                        className="form-select form-select-sm"
                                        value={line.productVersionId}
                                        onChange={e => updateLine(i, 'productVersionId', e.target.value)}
                                        required
                                        disabled={!line.productId}
                                      >
                                        <option value="">— Version —</option>
                                        {vers.map(v => <option key={v.id} value={v.id}>{v.version}</option>)}
                                      </select>
                                    </td>
                                    <td>
                                      <input
                                        type="number" min="1" step="1"
                                        className="form-control form-control-sm"
                                        value={line.quantity}
                                        onChange={e => updateLine(i, 'quantity', e.target.value)}
                                        required
                                      />
                                    </td>
                                    <td>
                                      <select
                                        className="form-select form-select-sm"
                                        value={line.occasionSeasonId}
                                        onChange={e => updateLine(i, 'occasionSeasonId', e.target.value)}
                                      >
                                        <option value="">Unassigned</option>
                                        {(form.occasionId
                                          ? seasonsForOccasion(form.occasionId)
                                          : seasons
                                        ).map(s => (
                                          <option key={s.id} value={s.id}>{s.name}</option>
                                        ))}
                                      </select>
                                    </td>
                                    <td>
                                      <input
                                        type="number" min="0" step="0.01"
                                        className="form-control form-control-sm"
                                        value={line.unitPrice}
                                        onChange={e => updateLine(i, 'unitPrice', e.target.value)}
                                      />
                                    </td>
                                    <td>
                                      <select className="form-select form-select-sm" value={line.gstRate} onChange={e => updateLine(i, 'gstRate', e.target.value)}>
                                        {[0, 5, 12, 18, 28].map(r => <option key={r} value={r}>{r}%</option>)}
                                      </select>
                                    </td>
                                    <td>
                                      <span className="form-control form-control-sm bg-light text-muted" style={{ display: 'block' }}>
                                        {line.costPerUnit || '—'}
                                      </span>
                                    </td>
                                    <td className="text-end">{formatCurrency(tax.lineTotal)}</td>
                                    <td>
                                      {lines.length > 1 && (
                                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => removeLine(i)}>✕</button>
                                      )}
                                    </td>
                                  </tr>
                                  {prod && (
                                    <tr className="table-light">
                                      <td colSpan={9} className="py-1 px-3">
                                        <div className="d-flex flex-wrap gap-3 small text-muted">
                                          <span>
                                            <span className="fw-semibold text-dark">Stock: </span>
                                            <span className={stock === 0 ? 'text-danger fw-semibold' : 'text-success fw-semibold'}>{stock}</span>
                                          </span>
                                          <span>
                                            <span className="fw-semibold text-dark">Default Price: </span>
                                            {formatCurrency(prod.defaultSellingPrice)}
                                          </span>
                                          <span>
                                            <span className="fw-semibold text-dark">Cost/Unit: </span>
                                            {formatCurrency(parseFloat(line.costPerUnit) || 0)}
                                          </span>
                                          {qty > 0 && (
                                            <span>
                                              <span className="fw-semibold text-dark">Qty Ordered: </span>{qty}
                                            </span>
                                          )}
                                          {qty > 0 && (
                                            <span className={needToProduce > 0 ? 'text-warning fw-semibold' : 'text-success'}>
                                              {needToProduce > 0
                                                ? `⚠ Need to produce: ${needToProduce}`
                                                : '✓ Stock sufficient'}
                                            </span>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                  </React.Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                        <button type="button" className="btn btn-outline-secondary btn-sm mb-3" onClick={addLine}>+ Add Item</button>
                        <div className="border-top pt-3">
                          <div className="row g-2 mb-2">
                            {(() => {
                              const totalCostAmt = lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.costPerUnit) || 0), 0)
                              const totalRevenueAmt = total
                              const totalProfit = totalRevenueAmt - totalCostAmt
                              const marginPct = totalRevenueAmt > 0 ? (totalProfit / totalRevenueAmt) * 100 : 0
                              return (
                                <>
                                  {[
                                    { label: 'Total Revenue', value: formatCurrency(totalRevenueAmt), color: '' },
                                    { label: 'Total Cost', value: formatCurrency(totalCostAmt), color: 'text-danger' },
                                    { label: 'Gross Profit', value: formatCurrency(totalProfit), color: totalProfit >= 0 ? 'text-success' : 'text-danger' },
                                    { label: 'Margin', value: `${marginPct.toFixed(1)}%`, color: marginPct >= 20 ? 'text-success' : marginPct >= 10 ? 'text-warning' : 'text-danger' },
                                  ].map(({ label, value, color }) => (
                                    <div key={label} className="col-6 col-md-3">
                                      <div className="border rounded p-2 text-center">
                                        <div className="text-muted small">{label}</div>
                                        <div className={`fw-bold ${color}`}>{value}</div>
                                      </div>
                                    </div>
                                  ))}
                                </>
                              )
                            })()}
                          </div>
                          <div className="text-end">
                            <div className="small text-muted">Taxable {formatCurrency(subtotal)} · GST {formatCurrency(gstTotal)} · Discount {formatCurrency(discountAmt)}</div>
                            <div className="fw-bold">Grand total: {formatCurrency(total)}</div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                  <div className="modal-footer">
                    {step === 2 && (
                      <button type="button" className="btn btn-secondary me-auto" onClick={() => setStep(1)}>← Back</button>
                    )}
                    <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)} disabled={saving}>Cancel</button>
                    <button type="submit" className="btn btn-primary" disabled={saving}>
                      {step === 1 ? 'Next: Add Items →' : saving ? 'Creating…' : 'Create Order'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        </>
      )}
      <EntityQuickCreate
        kind="customer"
        show={showCustomerCreate}
        onCancel={() => setShowCustomerCreate(false)}
        onCreated={created => {
          if (created.kind !== 'customer') return
          setCustomers(prev => [...prev, created.entity])
          setForm(f => ({ ...f, customerId: created.entity.id }))
          setShowCustomerCreate(false)
        }}
      />
    </div>
  )
}
