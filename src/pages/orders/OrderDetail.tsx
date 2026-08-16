import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { useAuth } from '../../hooks/useAuth'
import { orderService } from '../../services/orders'
import { customerService } from '../../services/customers'
import { productService } from '../../services/products'
import { Order, OrderItem, OrderStatus, Customer } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { formatCurrency, formatDate } from '../../utils/format'

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
  const { role } = useAuth()
  const isWorker = role === 'worker'

  // Shipment form state
  const [shipLogistics, setShipLogistics] = useState('')
  const [shipTracking, setShipTracking] = useState('')
  const [shipCost, setShipCost] = useState('')
  const [shipPhotos, setShipPhotos] = useState<File[]>([])
  const [shipExistingUrls, setShipExistingUrls] = useState<string[]>([])
  const [savingShipment, setSavingShipment] = useState(false)
  const shipFileRef = useRef<HTMLInputElement>(null)

  // Bill photo lightbox
  const [viewingPhotos, setViewingPhotos] = useState<string[] | null>(null)
  const [viewingIdx, setViewingIdx] = useState(0)

  const load = async () => {
    if (!id) return
    setLoading(true)
    try {
      const [o, rawItems, products, versions] = await Promise.all([
        orderService.getById(id),
        orderService.getItems(id),
        productService.getAll(),
        productService.getAllVersions(),
      ])
      if (!o) { showToast('Order not found', 'danger'); setLoading(false); return }
      setOrder(o)

      // Populate shipment form from stored data
      setShipLogistics(o.shipment?.logisticsCompany ?? '')
      setShipTracking(o.shipment?.trackingId ?? '')
      setShipCost(o.shipment?.cost != null ? String(o.shipment.cost) : '')
      setShipExistingUrls(o.shipment?.photoUrls ?? [])

      const prodMap = Object.fromEntries(products.map(p => [p.id, p.name]))
      const verMap = Object.fromEntries(versions.map(v => [v.id, v.version]))
      setItems(rawItems.map(i => ({
        ...i,
        productName: prodMap[i.productId] ?? i.productId,
        versionLabel: verMap[i.productVersionId] ?? '—',
      })))

      if (!isWorker) {
        const c = await customerService.getById(o.customerId)
        setCustomer(c)
      }
    } catch {
      showToast('Failed to load order', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

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
        cost: parseFloat(shipCost) || 0,
        photoUrls,
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
    <div className="container-fluid py-3">
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
  const showShipment = ['DISPATCHED', 'DELIVERED', 'COMPLETED'].includes(order.status)
  const shipmentReadOnly = order.status === 'COMPLETED'

  return (
    <div className="container-fluid py-3">
      <ToastContainer toasts={toasts} />
      <ConfirmModal
        show={showCancel}
        title="Cancel Order"
        message="Are you sure you want to cancel this order? This cannot be undone."
        confirmLabel="Cancel Order"
        onConfirm={handleCancel}
        onCancel={() => setShowCancel(false)}
      />

      {/* Header */}
      <div className="d-flex align-items-center gap-3 mb-4 flex-wrap">
        <button className="btn btn-outline-secondary btn-sm" onClick={() => navigate('/orders')}>
          &larr; Back
        </button>
        <h4 className="mb-0 font-monospace">{id?.slice(0, 6).toUpperCase()}</h4>
        <span className={`badge bg-${STATUS_BADGE[order.status]}`}>{order.status.replace(/_/g, ' ')}</span>

        <div className="ms-auto d-flex gap-2">
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
        </div>
      </div>

      {/* Order Info Card */}
      <div className="card mb-4">
        <div className="card-body">
          <div className="row g-3">
            <div className="col-md-3">
              <small className="text-muted d-block">Customer</small>
              <span className="fw-semibold">{customer?.name ?? order.customerId}</span>
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
          </div>
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
                <div className="col-md-4">
                  <small className="text-muted d-block">Shipping Cost</small>
                  <span>{order.shipment?.cost != null ? formatCurrency(order.shipment.cost) : '—'}</span>
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
        <div className="card-header">
          <h5 className="mb-0">Order Items</h5>
        </div>
        <div className="table-responsive">
          <table className="table table-sm mb-0">
            <thead className="table-light">
              <tr>
                <th>Product</th>
                <th>Version</th>
                <th>Qty</th>
                {!isWorker && <th className="text-end">Unit Price</th>}
                {!isWorker && <th className="text-end">Total</th>}
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
                  <span className="text-muted">Subtotal</span>
                  <span>{formatCurrency(order.subtotal)}</span>
                </div>
                <div className="d-flex justify-content-between fw-bold border-top pt-2 mb-2">
                  <span>Total</span>
                  <span>{formatCurrency(order.total)}</span>
                </div>
                <div className="d-flex justify-content-between text-muted small mb-1">
                  <span>Total Cost</span>
                  <span>{formatCurrency(totalCost)}</span>
                </div>
                <div className={`d-flex justify-content-between small ${totalProfit < 0 ? 'text-danger' : 'text-success'}`}>
                  <span>Total Profit</span>
                  <span>{formatCurrency(totalProfit)}</span>
                </div>
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
