import { useState, useEffect, useCallback, useRef } from 'react'
import { Timestamp } from 'firebase/firestore'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { purchaseService } from '../../services/purchases'
import { supplierService } from '../../services/suppliers'
import { materialService } from '../../services/materials'
import { formatCurrency, formatDate } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import ToastContainer from '../../components/ToastContainer'
import type { Purchase, Supplier, Material } from '../../types'
import { useAuth } from '../../hooks/useAuth'

interface LineItem {
  materialId: string
  quantity: string
  unitCost: number
}

const nowStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const emptyItem = (): LineItem => ({ materialId: '', quantity: '1', unitCost: 0 })

export default function PurchasePage() {
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const isWorker = role === 'worker'

  // Form state
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(nowStr())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([emptyItem()])
  const [billPhotos, setBillPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Bill photo viewer state
  const [viewingBills, setViewingBills] = useState<string[] | null>(null)
  const [viewingIdx, setViewingIdx] = useState(0)

  // History state
  const [history, setHistory] = useState<Purchase[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [supplierMap, setSupplierMap] = useState<Record<string, Supplier>>({})

  useEffect(() => {
    setItems([emptyItem()])
  }, [])

  useEffect(() => {
    supplierService.getAll().then(all => {
      setSuppliers(all.filter(s => s.status === 'active'))
      const map: Record<string, Supplier> = {}
      all.forEach(s => { map[s.id] = s })
      setSupplierMap(map)
    })
    materialService.getAll().then(all => {
      setMaterials(all.filter(m => m.status === 'active'))
    })
  }, [])

  const loadHistory = useCallback(() => {
    setHistoryLoading(true)
    purchaseService.getAll()
      .then(setHistory)
      .finally(() => setHistoryLoading(false))
  }, [])

  useEffect(() => { loadHistory() }, [loadHistory])

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const runningTotal = items.reduce((s, i) => s + (parseFloat(i.quantity) || 0) * i.unitCost, 0)
  const canSubmit = supplierId && items.length > 0 && items.every(i => i.materialId && parseFloat(i.quantity) > 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    try {
      const ts = Timestamp.fromDate(new Date(purchaseDate))

      const materialMap: Record<string, Material> = {}
      materials.forEach(m => { materialMap[m.id] = m })

      // Upload photos first so the URL list is available for the batch write
      const billPhotoUrls = billPhotos.length
        ? await Promise.all(billPhotos.map(async file => {
            const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
            const sRef = storageRef(storage, `purchases/pending/${tmpId}-${file.name}`)
            await uploadBytes(sRef, file)
            return getDownloadURL(sRef)
          }))
        : []

      await purchaseService.complete({
        supplierId,
        purchaseDate: ts,
        notes,
        billPhotoUrls,
        items: items.map(i => ({
          materialId: i.materialId,
          quantity: parseFloat(i.quantity) || 0,
          unitCost: i.unitCost,
          unit: materialMap[i.materialId]?.unit ?? '',
        })),
      })

      showToast('Purchase completed successfully', 'success')
      setSupplierId('')
      setPurchaseDate(nowStr())
      setNotes('')
      setItems([emptyItem()])
      setBillPhotos([])
      if (fileRef.current) fileRef.current.value = ''
      loadHistory()
    } catch (err) {
      showToast('Failed to complete purchase', 'danger')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container-fluid py-3">
      <ToastContainer toasts={toasts} />

      {/* Section 1 — New Purchase */}
      <div className="card mb-4">
        <div className="card-header">
          <h5 className="mb-0">New Purchase</h5>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3 mb-3">
              <div className="col-md-4">
                <label className="form-label">Supplier</label>
                <select
                  className="form-select"
                  value={supplierId}
                  onChange={e => setSupplierId(e.target.value)}
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              <div className="col-md-3">
                <label className="form-label">Purchase Date</label>
                <input
                  type="datetime-local"
                  className="form-control"
                  value={purchaseDate}
                  onChange={e => setPurchaseDate(e.target.value)}
                />
              </div>

              <div className="col-12">
                <label className="form-label">Notes</label>
                <textarea
                  className="form-control"
                  rows={2}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  placeholder="Optional notes…"
                />
              </div>
              <div className="col-12">
                <label className="form-label">Bill / Receipt Photos</label>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="form-control"
                  onChange={e => setBillPhotos(e.target.files ? Array.from(e.target.files) : [])}
                />
                {billPhotos.length > 0 && (
                  <div className="d-flex flex-wrap gap-1 mt-2">
                    {billPhotos.map(f => (
                      <span key={f.name} className="badge bg-secondary">{f.name}</span>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Line Items */}
            <h6 className="mb-2">Line Items</h6>
            <div className="table-responsive mb-2">
              <table className="table table-sm table-bordered align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Material</th>
                    <th style={{ width: '120px' }}>Quantity</th>
                    {!isWorker && <th style={{ width: '150px' }}>Unit Cost (₹)</th>}
                    {!isWorker && <th style={{ width: '130px' }}>Total</th>}
                    <th style={{ width: '60px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        <select
                          className="form-select form-select-sm"
                          value={item.materialId}
                          onChange={e => updateItem(idx, { materialId: e.target.value })}
                        >
                          <option value="">Select material…</option>
                          {materials.map(m => (
                            <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          min="0"
                          step="1"
                          value={item.quantity}
                          onChange={e => setItems(prev =>
                            prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it)
                          )}
                        />
                      </td>
                      {!isWorker && (
                        <td>
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            min={0}
                            step="0.01"
                            value={item.unitCost === 0 ? '' : item.unitCost}
                            placeholder="0"
                            onChange={e => updateItem(idx, { unitCost: parseFloat(e.target.value) || 0 })}
                          />
                        </td>
                      )}
                      {!isWorker && <td>{formatCurrency((parseFloat(item.quantity) || 0) * item.unitCost)}</td>}
                      <td>
                        <button
                          type="button"
                          className="btn btn-sm btn-outline-danger"
                          onClick={() => removeItem(idx)}
                          disabled={items.length === 1}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d-flex align-items-center justify-content-between mb-3">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setItems(prev => [...prev, emptyItem()])}
              >
                + Add Item
              </button>
              {!isWorker && (
                <div className="fw-bold fs-6">
                  Running Total: {formatCurrency(runningTotal)}
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary"
              disabled={!canSubmit || submitting}
            >
              {submitting ? 'Processing…' : 'Complete Purchase'}
            </button>
          </form>
        </div>
      </div>

      {/* Section 2 — Purchase History */}
      <div className="card">
        <div className="card-header">
          <h5 className="mb-0">Purchase History</h5>
        </div>
        <div className="card-body p-0">
          {historyLoading ? (
            <div className="p-3"><LoadingSpinner /></div>
          ) : history.length === 0 ? (
            <div className="p-3">
              <EmptyState message="No purchases yet." />
            </div>
          ) : (
            <div className="table-responsive">
              <table className="table table-hover mb-0 align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Date</th>
                    <th>Supplier</th>
                    <th>Materials</th>
                    <th>Total Qty</th>
                    {!isWorker && <th>Total (₹)</th>}
                    <th>Bills</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(p => (
                    <tr key={p.id}>
                      <td>{formatDate(p.purchaseDate)}</td>
                      <td>{supplierMap[p.supplierId]?.name ?? p.supplierId}</td>
                      <td>{p.itemCount ?? '—'}</td>
                      <td>{p.totalQty ?? '—'}</td>
                      {!isWorker && <td>{formatCurrency(p.total)}</td>}
                      <td>
                        {p.billPhotoUrls?.length ? (
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => { setViewingBills(p.billPhotoUrls!); setViewingIdx(0) }}
                          >
                            📄 {p.billPhotoUrls.length}
                          </button>
                        ) : '—'}
                      </td>
                      <td>
                        <span className={`badge ${
                          p.status === 'COMPLETED' ? 'bg-success' :
                          p.status === 'CANCELLED' ? 'bg-danger' : 'bg-secondary'
                        }`}>
                          {p.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {/* Bill Photo Viewer */}
      {viewingBills && (
        <>
          <div className="modal-backdrop fade show" onClick={() => setViewingBills(null)} />
          <div className="modal d-block" tabIndex={-1} onClick={() => setViewingBills(null)}>
            <div className="modal-dialog modal-lg modal-dialog-centered" onClick={e => e.stopPropagation()}>
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">Bill / Receipt ({viewingIdx + 1} of {viewingBills.length})</h5>
                  <button className="btn-close" onClick={() => setViewingBills(null)} />
                </div>
                <div className="modal-body text-center p-2">
                  <img
                    src={viewingBills[viewingIdx]}
                    alt={`Bill ${viewingIdx + 1}`}
                    className="img-fluid rounded"
                    style={{ maxHeight: '70vh', objectFit: 'contain' }}
                  />
                </div>
                {viewingBills.length > 1 && (
                  <div className="modal-footer justify-content-center gap-2">
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      disabled={viewingIdx === 0}
                      onClick={() => setViewingIdx(i => i - 1)}
                    >
                      ← Prev
                    </button>
                    <span className="text-muted small">{viewingIdx + 1} / {viewingBills.length}</span>
                    <button
                      className="btn btn-outline-secondary btn-sm"
                      disabled={viewingIdx === viewingBills.length - 1}
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
