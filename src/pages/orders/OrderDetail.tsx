import { useState, useEffect, useRef, type FormEvent } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { useAuth } from '../../hooks/useAuth'
import { isWorker as roleIsWorker } from '../../utils/roles'
import { orderService } from '../../services/orders'
import { customerService } from '../../services/customers'
import { productService } from '../../services/products'
import { bankService } from '../../services/bank'
import { Order, OrderItem, OrderStatus, Customer, BankTransaction } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency, formatDate } from '../../utils/format'
import OrderFormModal, {
  OrderFormLine,
  OrderFormValues,
  itemsToLines,
  orderFormToPayload,
  orderToForm,
} from '../../components/OrderFormModal'
import { usersService } from '../../services/users'
import WorkerPicker from '../../components/WorkerPicker'
import { isAdminOrOwner } from '../../utils/roles'
import type { WorkerOption, BankPaymentKind } from '../../types'

const STATUS_BADGE: Record<OrderStatus, string> = {
  DRAFT: 'secondary',
  QUOTED: 'info',
  CONFIRMED: 'primary',
  IN_PRODUCTION: 'warning',
  READY: 'success',
  DISPATCHED: 'info',
  DELIVERED: 'success',
  COMPLETED: 'dark',
  CANCELLED: 'danger',
}

const STATUS_FLOW: Partial<Record<OrderStatus, { next: OrderStatus; label: string; btnClass: string }>> = {
  DRAFT:         { next: 'QUOTED',        label: 'Mark as Quoted',     btnClass: 'btn-info' },
  QUOTED:        { next: 'CONFIRMED',     label: 'Confirm Order',      btnClass: 'btn-primary' },
  CONFIRMED:     { next: 'IN_PRODUCTION', label: 'Mark In Production', btnClass: 'btn-warning' },
  IN_PRODUCTION: { next: 'READY',         label: 'Mark Ready',         btnClass: 'btn-success' },
  READY:         { next: 'DISPATCHED',    label: 'Mark Dispatched',    btnClass: 'btn-info' },
  DISPATCHED:    { next: 'DELIVERED',     label: 'Mark Delivered',     btnClass: 'btn-success' },
  DELIVERED:     { next: 'COMPLETED',     label: 'Mark Completed',     btnClass: 'btn-dark' },
}

const TIMELINE_STAGES: { status: OrderStatus; label: string }[] = [
  { status: 'DRAFT',         label: 'Order Created' },
  { status: 'QUOTED',        label: 'Quoted' },
  { status: 'CONFIRMED',     label: 'Confirmed' },
  { status: 'IN_PRODUCTION', label: 'In Production' },
  { status: 'READY',         label: 'Ready' },
  { status: 'DISPATCHED',    label: 'Dispatched' },
  { status: 'DELIVERED',     label: 'Delivered' },
  { status: 'COMPLETED',     label: 'Completed' },
]

const STATUS_ORDER: OrderStatus[] = ['DRAFT','QUOTED','CONFIRMED','IN_PRODUCTION','READY','DISPATCHED','DELIVERED','COMPLETED']

interface EnrichedItem extends OrderItem {
  productName: string
  versionLabel: string
}

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { toasts, showToast } = useToast()
  const [order, setOrder] = useState<Order | null>(null)
  const [items, setItems] = useState<EnrichedItem[]>([])
  const [customer, setCustomer] = useState<Customer | null>(null)
  const [loading, setLoading] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  const [showCancel, setShowCancel] = useState(false)
  const { role, user, userDoc } = useAuth()
  const isWorker = roleIsWorker(role)
  const canAssign = isAdminOrOwner(role)
  const [workers, setWorkers] = useState<WorkerOption[]>([])
  const [payers, setPayers] = useState<WorkerOption[]>([])
  const [shipPaidById, setShipPaidById] = useState('')
  const [assignedIds, setAssignedIds] = useState<string[]>([])
  const [savingAssign, setSavingAssign] = useState(false)

  // Shipment form state
  const [shipLogistics, setShipLogistics] = useState('')
  const [shipTracking, setShipTracking] = useState('')
  const [shipCost, setShipCost] = useState('')
  const [shipPhotos, setShipPhotos] = useState<File[]>([])
  const [shipExistingUrls, setShipExistingUrls] = useState<string[]>([])
  const [savingShipment, setSavingShipment] = useState(false)
  const shipFileRef = useRef<HTMLInputElement>(null)
  const [bankTxs, setBankTxs] = useState<BankTransaction[]>([])
  const [editing, setEditing] = useState(false)
  const [savingEdit, setSavingEdit] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [showAddPayment, setShowAddPayment] = useState(false)
  const [savingPayment, setSavingPayment] = useState(false)
  const [paymentForm, setPaymentForm] = useState({
    amount: '',
    occurredAt: '',
    paymentKind: 'advance' as BankPaymentKind,
    notes: '',
  })

  // Bill photo lightbox
  const [viewingPhotos, setViewingPhotos] = useState<string[] | null>(null)
  const [viewingIdx, setViewingIdx] = useState(0)

  const load = async () => {
    if (!id) return
    setLoading(true)
    let redirected = false
    try {
      const [o, rawItems, products, versions] = await Promise.all([
        orderService.getById(id),
        orderService.getItems(id),
        productService.getAll(),
        productService.getAllVersions(),
      ])
      if (!o) { showToast('Order not found', 'danger'); setLoading(false); return }
      if (isWorker && !(o.assignedWorkerIds ?? []).includes(user?.uid ?? '')) {
        redirected = true
        navigate('/orders', { replace: true })
        return
      }
      setOrder(o)
      setAssignedIds(o.assignedWorkerIds ?? [])

      // Populate shipment form from stored data
      setShipLogistics(o.shipment?.logisticsCompany ?? '')
      setShipTracking(o.shipment?.trackingId ?? '')
      setShipCost(o.shipment?.cost != null ? String(o.shipment.cost) : '')
      setShipExistingUrls(o.shipment?.photoUrls ?? [])
      setShipPaidById(o.shipment?.paidById ?? '')

      const prodMap = Object.fromEntries(products.map(p => [p.id, p.name]))
      const verMap = Object.fromEntries(versions.map(v => [v.id, v.version]))
      setItems(rawItems.map(i => ({
        ...i,
        productName: prodMap[i.productId] ?? i.productId,
        versionLabel: verMap[i.productVersionId] ?? '—',
      })))

      if (!isWorker) {
        const [c, linkedBank] = await Promise.all([
          customerService.getById(o.customerId),
          bankService.listByOrderId(id).catch(() => [] as BankTransaction[]),
        ])
        setCustomer(c)
        setBankTxs(linkedBank)
      } else {
        setBankTxs([])
      }
    } catch {
      if (isWorker) {
        redirected = true
        navigate('/orders', { replace: true })
        return
      }
      showToast('Failed to load order', 'danger')
    } finally {
      if (!redirected) setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])
  useEffect(() => {
    if (canAssign) usersService.listWorkers().then(setWorkers).catch(() => {})
  }, [canAssign])
  useEffect(() => {
    const self: WorkerOption[] = user ? [{ id: user.uid, name: userDoc?.name?.trim() || user.email || 'You', email: user.email || '' }] : []
    if (isWorker) { setPayers(self); return }
    usersService.listActive()
      .then(list => setPayers([...list].sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => setPayers(self))
  }, [isWorker, user, userDoc])

  const handleTransition = async (next: OrderStatus) => {
    if (!id) return
    setTransitioning(true)
    try {
      await orderService.updateStatus(id, next)
      showToast(`Order moved to ${next.replace(/_/g, ' ')}`)
      await load()
    } catch {
      showToast('Failed to update status', 'danger')
    } finally {
      setTransitioning(false)
    }
  }

  const handleCancel = async () => {
    if (!id) return
    setShowCancel(false)
    setTransitioning(true)
    try {
      await orderService.cancel(id)
      showToast('Order cancelled')
      await load()
    } catch {
      showToast('Failed to cancel order', 'danger')
    } finally {
      setTransitioning(false)
    }
  }

  const handleSaveShipment = async () => {
    if (!id) return
    setSavingShipment(true)
    try {
      let photoUrls = [...shipExistingUrls]
      if (shipPhotos.length > 0) {
        const uploaded = await Promise.all(shipPhotos.map(async file => {
          const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
          const sRef = storageRef(storage, `shipments/${id}/${tmpId}-${file.name}`)
          await uploadBytes(sRef, file)
          return getDownloadURL(sRef)
        }))
        photoUrls = [...photoUrls, ...uploaded]
      }
      await orderService.updateShipment(id, {
        logisticsCompany: shipLogistics,
        trackingId: shipTracking,
        cost: isWorker ? (order?.shipment?.cost ?? 0) : (parseFloat(shipCost) || 0),
        photoUrls,
        bankTransactionId: order?.shipment?.bankTransactionId ?? null,
        paidById: shipPaidById,
        paidByName: payers.find(p => p.id === shipPaidById)?.name ?? order?.shipment?.paidByName ?? '',
      })
      showToast('Shipment details saved', 'success')
      setShipPhotos([])
      if (shipFileRef.current) shipFileRef.current.value = ''
      await load()
    } catch {
      showToast('Failed to save shipment details', 'danger')
    } finally {
      setSavingShipment(false)
    }
  }

  if (loading) return <LoadingSpinner />
  if (!order) return (
    <div>
      <p className="text-danger">Order not found.</p>
      <button className="btn btn-secondary" onClick={() => navigate('/orders')}>Back</button>
    </div>
  )

  const WORKER_FLOW: Partial<typeof STATUS_FLOW> = {
    CONFIRMED:     { next: 'IN_PRODUCTION', label: 'Mark In Production', btnClass: 'btn-warning' },
    IN_PRODUCTION: { next: 'READY',         label: 'Mark Ready',         btnClass: 'btn-success' },
    READY:         { next: 'DISPATCHED',    label: 'Mark Dispatched',    btnClass: 'btn-info' },
  }
  const flow = isWorker ? WORKER_FLOW[order.status] : STATUS_FLOW[order.status]
  const canCancel = !isWorker && order.status !== 'CANCELLED' && order.status !== 'COMPLETED'
  const totalCost = items.reduce((s, i) => s + i.totalCost, 0)
  const totalProfit = items.reduce((s, i) => s + i.profit, 0)

  const currentIdx = STATUS_ORDER.indexOf(order.status)
  const showShipment = ['CONFIRMED', 'IN_PRODUCTION', 'READY', 'DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(order.status)
  const shipmentReadOnly = order.status === 'COMPLETED'
  const canEditAssignment = canAssign && order.status === 'IN_PRODUCTION'
  const hasAssignment = (order.assignedWorkerNames ?? []).length > 0
  const laterStatus = !['DRAFT', 'QUOTED', 'CONFIRMED'].includes(order.status)
  const showAssignedReadOnly = !canEditAssignment && (isWorker || order.status === 'IN_PRODUCTION' || (laterStatus && hasAssignment))

  const paymentTxs = bankTxs.filter(t => t.paymentKind === 'advance' || t.paymentKind === 'final')
  const logisticsTxs = bankTxs.filter(t => t.expenseKind === 'logistics')
  const workerPayTxs = bankTxs.filter(t => t.workerPayKind === 'payout')
  const collected = paymentTxs.reduce((s, t) => s + (t.direction === 'credit' ? t.amount : 0), 0)
  const orderTotal = Number(order.grandTotal ?? order.total ?? 0)
  const remaining = orderTotal - collected
  const logisticsBankSum = logisticsTxs.reduce((s, t) => s + t.amount, 0)
  const shipCostNum = order.shipment?.cost != null ? Number(order.shipment.cost) : null
  const logisticsOk =
    logisticsTxs.length > 0 &&
    (shipCostNum == null || Math.abs(shipCostNum - logisticsBankSum) <= 1)
  const workerPaySum = workerPayTxs.reduce((s, t) => s + t.amount, 0)

  const nowDatetimeLocal = () => {
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const openAddPayment = () => {
    setPaymentForm({
      amount: remaining > 0 ? String(Math.round(remaining * 100) / 100) : '',
      occurredAt: nowDatetimeLocal(),
      paymentKind: collected > 0 ? 'final' : 'advance',
      notes: '',
    })
    setShowAddPayment(true)
  }

  const handleAddPayment = async (e: FormEvent) => {
    e.preventDefault()
    if (!id) return
    const amount = parseFloat(paymentForm.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter a payment amount greater than 0', 'warning')
      return
    }
    const occurredAt = paymentForm.occurredAt ? new Date(paymentForm.occurredAt) : new Date()
    if (Number.isNaN(occurredAt.getTime())) {
      showToast('Enter a valid date', 'warning')
      return
    }
    setSavingPayment(true)
    try {
      await bankService.createManualCustomerPayment({
        orderId: id,
        amount,
        paymentKind: paymentForm.paymentKind,
        occurredAt,
        notes: paymentForm.notes.trim() || undefined,
      })
      const linkedBank = await bankService.listByOrderId(id)
      setBankTxs(linkedBank)
      setShowAddPayment(false)
      showToast('Payment recorded')
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to record payment', 'danger')
    } finally {
      setSavingPayment(false)
    }
  }

  const handleSaveEdit = async (form: OrderFormValues, lines: OrderFormLine[]) => {
    if (!id) return
    const payload = orderFormToPayload(form, lines)
    if (payload.items.length === 0) {
      showToast('Add at least one line item', 'warning')
      return
    }
    setSavingEdit(true)
    try {
      await orderService.update(id, payload)
      showToast('Order updated')
      setEditing(false)
      await load()
    } catch {
      showToast('Failed to update order', 'danger')
    } finally {
      setSavingEdit(false)
    }
  }

  const handleSaveAssignment = async () => {
    if (!id) return
    setSavingAssign(true)
    try {
      const names = workers.filter(w => assignedIds.includes(w.id)).map(w => w.name)
      await orderService.assign(id, assignedIds, names, user?.uid ?? '')
      showToast('Assignment saved')
      await load()
    } catch {
      showToast('Could not save assignment', 'danger')
    } finally {
      setSavingAssign(false)
    }
  }

  return (
    <div>
      <ToastContainer toasts={toasts} />
      <ConfirmModal
        show={showCancel}
        title="Cancel Order"
        message="Are you sure you want to cancel this order? This cannot be undone."
        confirmLabel="Cancel Order"
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />
      <ConfirmModal
        show={confirmDelete}
        title="Delete Order"
        message={`Delete this order? ${order.status === 'COMPLETED' ? 'The stock it sold is put back.' : 'This cannot be undone.'}`}
        confirmLabel="Delete"
        onConfirm={async () => {
          if (!id) return
          try {
            await orderService.delete(id)
            navigate('/orders')
          } catch {
            setConfirmDelete(false)
            showToast('Failed to delete order', 'danger')
          }
        }}
        onCancel={() => setConfirmDelete(false)}
      />

      {/* Header */}
      <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/orders')}>
          &larr; Back
        </button>
        <h4 className="mb-0 font-monospace">{id?.slice(0, 6).toUpperCase()}</h4>
        <span className={`badge bg-${STATUS_BADGE[order.status]}`}>{order.status.replace(/_/g, ' ')}</span>

        <div className="ms-auto d-flex gap-2">
          {!isWorker && (
            <button className="btn btn-sm btn-outline-primary" onClick={() => setEditing(true)}>
              Edit Order
            </button>
          )}
          {flow && (
            <button
              className={`btn btn-sm ${flow.btnClass}`}
              disabled={transitioning}
              onClick={() => handleTransition(flow.next)}
            >
              {transitioning ? 'Updating…' : flow.label}
            </button>
          )}
          {canCancel && (
            <button className="btn btn-sm btn-outline-danger" onClick={() => setShowCancel(true)} disabled={transitioning}>
              Cancel Order
            </button>
          )}
          {canAssign && (
            <button className="btn btn-sm btn-danger" onClick={() => setConfirmDelete(true)} disabled={transitioning}>
              Delete
            </button>
          )}
        </div>
      </div>

      {/* Order Info Card */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-3">
              <small className="text-muted d-block">Customer</small>
              <span className="fw-semibold">{isWorker ? '—' : (customer?.name ?? order.customerId)}</span>
            </div>
            <div className="col-md-3">
              <small className="text-muted d-block">Order Date</small>
              <span>{formatDate(order.orderDate)}</span>
            </div>
            <div className="col-md-3">
              <small className="text-muted d-block">Event Date</small>
              <span>{formatDate(order.eventDate)}</span>
            </div>
            <div className="col-md-3">
              <small className="text-muted d-block">Event Type</small>
              <span>{order.eventType || '—'}</span>
            </div>
            {showAssignedReadOnly && (
              <div className="col-md-12">
                <small className="text-muted d-block">Assigned</small>
                <span>{(order.assignedWorkerNames ?? []).join(', ') || 'Unassigned'}</span>
              </div>
            )}
          </div>
          {canEditAssignment && (
            <div className="mt-3 pt-3 border-top">
              <WorkerPicker workers={workers} selectedIds={assignedIds} onChange={setAssignedIds} />
              <button
                className="btn btn-sm btn-outline-primary mt-2"
                disabled={savingAssign}
                onClick={handleSaveAssignment}
              >
                {savingAssign ? 'Saving…' : 'Save assignment'}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Order Timeline */}
      <div className="card mb-4">
        <div className="card-header">
          <h6 className="mb-0">Order Timeline</h6>
        </div>
        <div className="card-body py-3">
          <ul className="list-unstyled mb-0" style={{ borderLeft: '2px solid #dee2e6', paddingLeft: '1.75rem' }}>
            {TIMELINE_STAGES.map(({ status: s, label }, stageIdx) => {
              const reached = order.statusHistory?.[s]
              const isCurrent = order.status === s
              const isPast = reached != null || STATUS_ORDER.indexOf(s) < currentIdx
              const dotColor = isCurrent ? '#0d6efd' : isPast ? '#198754' : '#dee2e6'
              const dotBorder = isPast || isCurrent ? 'none' : '2px solid #adb5bd'
              return (
                <li
                  key={s}
                  className="mb-3 position-relative d-flex align-items-start gap-3"
                  style={{ marginLeft: '-1.88rem' }}
                >
                  <span
                    className="flex-shrink-0 mt-1"
                    style={{
                      width: 14, height: 14, borderRadius: '50%',
                      background: dotColor, border: dotBorder, display: 'inline-block',
                    }}
                  />
                  <div>
                    <span className={`fw-semibold ${isCurrent ? 'text-primary' : isPast ? '' : 'text-muted'}`}>
                      {label}
                    </span>
                    {reached ? (
                      <span className="ms-2 text-muted small">{formatDate(reached)}</span>
                    ) : isCurrent ? (
                      <span className="ms-2 badge bg-primary bg-opacity-10 text-primary small">Current</span>
                    ) : (
                      <span className="ms-2 text-muted small">—</span>
                    )}
                    {stageIdx === 0 && order.statusHistory?.DRAFT == null && (
                      <span className="ms-2 text-muted small">{formatDate(order.createdAt)}</span>
                    )}
                  </div>
                </li>
              )
            })}

            {/* Event Date milestone */}
            {order.eventDate && (
              <li
                className="mb-2 position-relative d-flex align-items-start gap-3"
                style={{ marginLeft: '-1.88rem', marginTop: '0.25rem' }}
              >
                <span className="flex-shrink-0 mt-1" style={{ width: 14, fontSize: 14, lineHeight: 1 }}>📅</span>
                <div>
                  <span className="fw-semibold text-warning">Event Date</span>
                  <span className="ms-2 text-muted small">{formatDate(order.eventDate)}</span>
                </div>
              </li>
            )}

            {/* Cancelled state */}
            {order.status === 'CANCELLED' && (
              <li
                className="position-relative d-flex align-items-start gap-3 mt-2"
                style={{ marginLeft: '-1.88rem' }}
              >
                <span className="flex-shrink-0 mt-1" style={{ width: 14, fontSize: 14, lineHeight: 1 }}>✕</span>
                <div>
                  <span className="fw-semibold text-danger">Cancelled</span>
                  {order.statusHistory?.CANCELLED && (
                    <span className="ms-2 text-muted small">{formatDate(order.statusHistory.CANCELLED)}</span>
                  )}
                </div>
              </li>
            )}
          </ul>
        </div>
      </div>

      {/* Bank reconciliation */}
      {!isWorker && (
        <div className="card mb-4">
          <div className="card-header d-flex justify-content-between align-items-center">
            <h6 className="mb-0">Bank reconciliation</h6>
            <Link to="/bank" className="small">
              Open Bank
            </Link>
          </div>
          <div className="card-body">
            <div className="row g-3">
              <div className="col-md-4">
                <div className="fw-semibold mb-1">Payments</div>
                <div className="small text-muted mb-1">
                  Collected {formatCurrency(collected)} / {formatCurrency(orderTotal)}
                  {remaining > 1 && (
                    <span className="text-warning"> · remaining {formatCurrency(remaining)}</span>
                  )}
                  {remaining <= 1 && collected > 0 && (
                    <span className="text-success"> · paid</span>
                  )}
                </div>
                {paymentTxs.length === 0 ? (
                  <div className="small text-muted">No customer payments tagged yet</div>
                ) : (
                  <ul className="list-unstyled small mb-0">
                    {paymentTxs.map(t => (
                      <li key={t.id}>
                        {formatDate(t.occurredAt)} · {t.paymentKind}
                        {t.source === 'manual' ? ' · manual' : ''} · {formatCurrency(t.amount)}
                      </li>
                    ))}
                  </ul>
                )}
                {!showAddPayment ? (
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm mt-2"
                    onClick={openAddPayment}
                  >
                    + Add payment
                  </button>
                ) : (
                  <form className="mt-2 border rounded p-2" onSubmit={e => void handleAddPayment(e)}>
                    <div className="mb-2">
                      <label className="form-label small mb-0">Amount (₹)</label>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        min={0}
                        step="0.01"
                        value={paymentForm.amount}
                        disabled={savingPayment}
                        onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0">Date</label>
                      <input
                        type="datetime-local"
                        className="form-control form-control-sm"
                        value={paymentForm.occurredAt}
                        disabled={savingPayment}
                        onChange={e => setPaymentForm(f => ({ ...f, occurredAt: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0">Kind</label>
                      <select
                        className="form-select form-select-sm"
                        value={paymentForm.paymentKind}
                        disabled={savingPayment}
                        onChange={e => setPaymentForm(f => ({
                          ...f,
                          paymentKind: e.target.value === 'final' ? 'final' : 'advance',
                        }))}
                      >
                        <option value="advance">advance</option>
                        <option value="final">final</option>
                      </select>
                    </div>
                    <div className="mb-2">
                      <label className="form-label small mb-0">Note (optional)</label>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        value={paymentForm.notes}
                        disabled={savingPayment}
                        onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))}
                        placeholder="Cash / UPI ref…"
                      />
                    </div>
                    <div className="d-flex gap-1">
                      <button type="submit" className="btn btn-primary btn-sm" disabled={savingPayment}>
                        {savingPayment ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline-secondary btn-sm"
                        disabled={savingPayment}
                        onClick={() => setShowAddPayment(false)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </div>
              <div className="col-md-4">
                <div className="fw-semibold mb-1">Logistics</div>
                <div className="small mb-1">
                  {logisticsTxs.length === 0 ? (
                    <span className="text-muted">No bank logistics tagged</span>
                  ) : logisticsOk ? (
                    <span className="badge text-bg-success">Reconciled</span>
                  ) : (
                    <span className="badge text-bg-warning">Amount differs / pending</span>
                  )}
                </div>
                <div className="small text-muted">
                  Shipment cost:{' '}
                  {shipCostNum != null ? formatCurrency(shipCostNum) : '—'} · Bank:{' '}
                  {formatCurrency(logisticsBankSum)}
                </div>
                {logisticsTxs.map(t => (
                  <div key={t.id} className="small">
                    {formatDate(t.occurredAt)} · {formatCurrency(t.amount)}
                  </div>
                ))}
              </div>
              <div className="col-md-4">
                <div className="fw-semibold mb-1">Worker pay</div>
                {workerPayTxs.length === 0 ? (
                  <div className="small text-muted">No job payouts tagged</div>
                ) : (
                  <>
                    <div className="small text-muted mb-1">Total {formatCurrency(workerPaySum)}</div>
                    <ul className="list-unstyled small mb-0">
                      {workerPayTxs.map(t => (
                        <li key={t.id}>
                          {formatDate(t.occurredAt)} · {formatCurrency(t.amount)}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Shipment Details */}
      {showShipment && (
        <div className="card mb-4">
          <div className="card-header">
            <h6 className="mb-0">Shipment Details</h6>
          </div>
          <div className="card-body">
            {shipmentReadOnly ? (
              <div className="row g-3">
                <div className="col-md-4">
                  <small className="text-muted d-block">Logistics Company</small>
                  <span>{order.shipment?.logisticsCompany || '—'}</span>
                </div>
                <div className="col-md-4">
                  <small className="text-muted d-block">Tracking ID</small>
                  <span>{order.shipment?.trackingId || '—'}</span>
                </div>
                {!isWorker && (
                  <div className="col-md-4">
                    <small className="text-muted d-block">Shipping Cost</small>
                    <span>{order.shipment?.cost != null ? formatCurrency(order.shipment.cost) : '—'}</span>
                  </div>
                )}
                <div className="col-md-4">
                  <small className="text-muted d-block">Paid by</small>
                  <span>{order.shipment?.paidByName || '—'}</span>
                </div>
                {order.shipment?.photoUrls?.length ? (
                  <div className="col-12">
                    <small className="text-muted d-block mb-1">Photos</small>
                    <button
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => { setViewingPhotos(order.shipment!.photoUrls!); setViewingIdx(0) }}
                    >
                      📄 {order.shipment.photoUrls.length} photo{order.shipment.photoUrls.length > 1 ? 's' : ''}
                    </button>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="row g-3">
                <div className="col-md-4">
                  <label className="form-label">Logistics Company</label>
                  <input
                    type="text"
                    className="form-control"
                    value={shipLogistics}
                    onChange={e => setShipLogistics(e.target.value)}
                    placeholder="e.g. Blue Dart, DTDC"
                  />
                </div>
                <div className="col-md-4">
                  <label className="form-label">Tracking ID</label>
                  <input
                    type="text"
                    className="form-control"
                    value={shipTracking}
                    onChange={e => setShipTracking(e.target.value)}
                    placeholder="Tracking number"
                  />
                </div>
                {!isWorker && (
                  <div className="col-md-4">
                    <label className="form-label">Shipping Cost (₹)</label>
                    <input
                      type="number"
                      className="form-control"
                      min={0}
                      step="0.01"
                      value={shipCost}
                      onChange={e => setShipCost(e.target.value)}
                      placeholder="0"
                    />
                  </div>
                )}
                <div className="col-md-4">
                  <label className="form-label">Paid by</label>
                  <select className="form-select" value={shipPaidById} onChange={e => setShipPaidById(e.target.value)}>
                    <option value="">Not recorded</option>
                    {shipPaidById && !payers.some(p => p.id === shipPaidById) && (
                      <option value={shipPaidById}>{order.shipment?.paidByName || 'Saved payer'}</option>
                    )}
                    {payers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div className="col-12">
                  <label className="form-label">Photos</label>
                  <input
                    ref={shipFileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="form-control"
                    onChange={e => setShipPhotos(e.target.files ? Array.from(e.target.files) : [])}
                  />
                  {shipPhotos.length > 0 && (
                    <div className="d-flex flex-wrap gap-1 mt-1">
                      {shipPhotos.map(f => (
                        <span key={f.name} className="badge bg-secondary">{f.name}</span>
                      ))}
                    </div>
                  )}
                  {shipExistingUrls.length > 0 && (
                    <div className="mt-2">
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => { setViewingPhotos(shipExistingUrls); setViewingIdx(0) }}
                      >
                        📄 View {shipExistingUrls.length} saved photo{shipExistingUrls.length > 1 ? 's' : ''}
                      </button>
                    </div>
                  )}
                </div>
                <div className="col-12">
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveShipment}
                    disabled={savingShipment}
                  >
                    {savingShipment ? 'Saving…' : 'Save Shipment Details'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Order Items */}
      <div className="card mb-4">
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">Order Items</h5>
          {!isWorker && (
            <button className="btn btn-sm btn-outline-primary" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
        </div>
        <div className="table-responsive">
          <table className="table table-sm mb-0">
            <thead className="table-light">
              <tr>
                <th>Product</th>
                <th>Version</th>
                <th>Qty</th>
                {!isWorker && <th className="text-end">Unit Price</th>}
                {!isWorker && <th className="text-end">GST</th>}
                {!isWorker && <th className="text-end">Line</th>}
                {!isWorker && <th className="text-end">Cost/Unit</th>}
                {!isWorker && <th className="text-end">Total Cost</th>}
                {!isWorker && <th className="text-end">Profit</th>}
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id}>
                  <td>{item.productName}</td>
                  <td>{item.versionLabel}</td>
                  <td>{item.quantity}</td>
                  {!isWorker && <td className="text-end">{formatCurrency(item.unitPrice)}</td>}
                  {!isWorker && <td className="text-end">{item.gstRate ?? 0}%</td>}
                  {!isWorker && <td className="text-end">{formatCurrency(item.totalPrice)}</td>}
                  {!isWorker && <td className="text-end">{formatCurrency(item.costPerUnit)}</td>}
                  {!isWorker && <td className="text-end">{formatCurrency(item.totalCost)}</td>}
                  {!isWorker && (
                    <td className={`text-end ${item.profit < 0 ? 'text-danger' : 'text-success'}`}>
                      {formatCurrency(item.profit)}
                    </td>
                  )}
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={isWorker ? 3 : 8} className="text-muted text-center py-3">No items</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Summary */}
      {!isWorker && (
        <div className="row g-4 mb-4">
          <div className="col-md-5 ms-auto">
            <div className="card">
              <div className="card-body">
                <div className="d-flex justify-content-between mb-2">
                  <span className="text-muted">Subtotal (taxable)</span>
                  <span>{formatCurrency(order.taxableSubtotal ?? order.subtotal)}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="text-muted">GST</span>
                  <span>{formatCurrency(order.gstTotal ?? 0)}</span>
                </div>
                {order.discount > 0 && (
                  <div className="d-flex justify-content-between mb-2">
                    <span className="text-muted">Discount</span>
                    <span>-{formatCurrency(order.discount)}</span>
                  </div>
                )}
                <div className="d-flex justify-content-between fw-bold border-top pt-2 mb-2">
                  <span>Grand total</span>
                  <span>{formatCurrency(order.grandTotal ?? order.total)}</span>
                </div>
                <div className="d-flex justify-content-between text-muted small mb-1">
                  <span>Total Cost</span>
                  <span>{formatCurrency(totalCost)}</span>
                </div>
                <div className={`d-flex justify-content-between small ${totalProfit < 0 ? 'text-danger' : 'text-success'}`}>
                  <span>Total Profit</span>
                  <span>{formatCurrency(totalProfit)}</span>
                </div>
                {shipCostNum != null && shipCostNum > 0 && (
                  <>
                    <div className="d-flex justify-content-between text-muted small mt-1">
                      <span>Shipping</span>
                      <span>−{formatCurrency(shipCostNum)}</span>
                    </div>
                    <div className={`d-flex justify-content-between small fw-semibold ${totalProfit - shipCostNum < 0 ? 'text-danger' : 'text-success'}`}>
                      <span>Profit after shipping</span>
                      <span>{formatCurrency(totalProfit - shipCostNum)}</span>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {order.notes && (
        <div className="card">
          <div className="card-header"><h5 className="mb-0">Notes</h5></div>
          <div className="card-body"><p className="mb-0">{order.notes}</p></div>
        </div>
      )}

      <OrderFormModal
        show={editing}
        mode="edit"
        initialForm={orderToForm(order)}
        initialLines={itemsToLines(items)}
        warning={
          order.status === 'COMPLETED'
            ? 'This order is completed. Changing quantities will not update inventory automatically.'
            : undefined
        }
        saving={savingEdit}
        onCancel={() => setEditing(false)}
        onSubmit={handleSaveEdit}
      />

      {/* Photo Lightbox */}
      {viewingPhotos && (
        <>
          <div className="modal-backdrop fade show" onClick={() => setViewingPhotos(null)} />
          <div className="modal d-block" tabIndex={-1} onClick={() => setViewingPhotos(null)}>
            <div className="modal-dialog modal-lg modal-dialog-centered" onClick={e => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Photo ({viewingIdx + 1} of {viewingPhotos.length})</h5>
                  <button className="btn-close" onClick={() => setViewingPhotos(null)} />
                </div>
                <div className="modal-body text-center p-2">
                  <img
                    src={viewingPhotos[viewingIdx]}
                    alt={`Photo ${viewingIdx + 1}`}
                    className="img-fluid rounded"
                    style={{ maxHeight: '70vh', objectFit: 'contain' }}
                  />
                </div>
                {viewingPhotos.length > 1 && (
                  <div className="modal-footer justify-content-center gap-2">
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      disabled={viewingIdx === 0}
                      onClick={() => setViewingIdx(i => i - 1)}
                    >
                      ← Prev
                    </button>
                    <span className="text-muted small">{viewingIdx + 1} / {viewingPhotos.length}</span>
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      disabled={viewingIdx === viewingPhotos.length - 1}
                      onClick={() => setViewingIdx(i => i + 1)}
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
