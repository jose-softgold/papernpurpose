import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { isWorker as roleIsWorker, canWriteMaster } from '../../utils/roles'
import { orderService } from '../../services/orders'
import { customerService } from '../../services/customers'
import { Order, OrderStatus } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import StatusBadge from '../../components/StatusBadge'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency, formatDate } from '../../utils/format'
import { exportToCSV } from '../../utils/export'
import OrderFormModal, {
  OrderFormLine,
  OrderFormValues,
  itemsToLines,
  orderFormToPayload,
  orderToForm,
} from '../../components/OrderFormModal'

const ALL_STATUSES: OrderStatus[] = ['DRAFT', 'QUOTED', 'CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED', 'CANCELLED']

interface OrderRow extends Order {
  customerName: string
}

export default function OrderList() {
  const navigate = useNavigate()
  const { toasts, showToast } = useToast()
  const [rows, setRows] = useState<OrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<'ALL' | OrderStatus>('ALL')
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null)
  const [editOrder, setEditOrder] = useState<Order | null>(null)
  const [editLines, setEditLines] = useState<OrderFormLine[] | undefined>(undefined)
  const [saving, setSaving] = useState(false)

  const { role, user } = useAuth()
  const isWorker = roleIsWorker(role)
  const canMaster = canWriteMaster(role)
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

  const openCreate = () => {
    setEditOrder(null)
    setEditLines(undefined)
    setFormMode('create')
  }

  const openEdit = async (order: Order) => {
    try {
      const items = await orderService.getItems(order.id)
      setEditOrder(order)
      setEditLines(itemsToLines(items))
      setFormMode('edit')
    } catch {
      showToast('Failed to load order for editing', 'danger')
    }
  }

  const closeForm = () => {
    setFormMode(null)
    setEditOrder(null)
    setEditLines(undefined)
  }

  const handleFormSubmit = async (form: OrderFormValues, lines: OrderFormLine[]) => {
    const payload = orderFormToPayload(form, lines)
    if (payload.items.length === 0) {
      showToast('Add at least one line item', 'warning')
      return
    }
    setSaving(true)
    try {
      if (formMode === 'edit' && editOrder) {
        await orderService.update(editOrder.id, payload)
        showToast('Order updated')
        closeForm()
        await load()
      } else {
        const id = await orderService.create(payload)
        showToast('Order created')
        closeForm()
        await load()
        navigate(`/orders/${id}`)
      }
    } catch {
      showToast(formMode === 'edit' ? 'Failed to update order' : 'Failed to create order', 'danger')
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
            {!isWorker && <button className="btn btn-primary btn-sm" onClick={openCreate}>+ New Order</button>}
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
                        <div className="d-flex gap-1">
                          <button className="btn btn-outline-primary btn-sm" onClick={() => navigate(`/orders/${r.id}`)}>
                            View
                          </button>
                          {!isWorker && (
                            <button className="btn btn-outline-secondary btn-sm" onClick={() => openEdit(r)}>
                              Edit
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </>
            )}
          </DataGrid>
        </div>

      <OrderFormModal
        show={formMode != null}
        mode={formMode === 'edit' ? 'edit' : 'create'}
        initialForm={editOrder ? orderToForm(editOrder) : undefined}
        initialLines={editLines}
        warning={
          editOrder?.status === 'COMPLETED'
            ? 'This order is completed. Changing quantities will not update inventory automatically.'
            : undefined
        }
        saving={saving}
        onCancel={closeForm}
        onSubmit={handleFormSubmit}
      />
    </div>
  )
}
