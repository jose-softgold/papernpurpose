import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Timestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { purchaseIsPaid, purchaseService } from '../../services/purchases'
import { usersService } from '../../services/users'
import { supplierService } from '../../services/suppliers'
import { materialService } from '../../services/materials'
import { bankService } from '../../services/bank'
import { formatCurrency, formatDate } from '../../utils/format'
import { lineTax } from '../../utils/tax'
import { useToast } from '../../hooks/useToast'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import ToastContainer from '../../components/ToastContainer'
import QuickSelect from '../../components/QuickSelect'
import EntityQuickCreate from '../../components/EntityQuickCreate'
import { GstRateSelect } from '../../components/GstFields'
import type { Purchase, Supplier, Material, BankTransaction, UserRole, WorkerOption } from '../../types'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner, isWorker as roleIsWorker, ROLE_LABELS } from '../../utils/roles'

interface LineItem {
  materialId: string
  quantity: string
  unitCost: number
  gstRate: number
}

const nowStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const emptyItem = (gstRate = 0): LineItem => ({ materialId: '', quantity: '1', unitCost: 0, gstRate })

type PurchaserOption = WorkerOption & { role: UserRole }

export default function PurchasePage() {
  const { toasts, showToast } = useToast()
  const { user, userDoc, role } = useAuth()
  const isWorker = roleIsWorker(role)
  const canRecordCash = isAdminOrOwner(role)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [purchasers, setPurchasers] = useState<PurchaserOption[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [purchasedById, setPurchasedById] = useState('')
  const [paymentStatus, setPaymentStatus] = useState<'paid' | 'unpaid'>('unpaid')
  const [purchaseDate, setPurchaseDate] = useState(nowStr())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([emptyItem()])
  const [billPhotos, setBillPhotos] = useState<File[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [closing, setClosing] = useState<{
    ids: string[]
    amount: string
    occurredAt: string
    notes: string
    label: string
  } | null>(null)
  const [savingCash, setSavingCash] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [quick, setQuick] = useState<'supplier' | 'material' | null>(null)
  const [materialTarget, setMaterialTarget] = useState(0)
  const materialsRef = useRef<Material[]>([])

  const [viewingBills, setViewingBills] = useState<string[] | null>(null)
  const [viewingIdx, setViewingIdx] = useState(0)

  const [history, setHistory] = useState<Purchase[]>([])
  const [historyLoading, setHistoryLoading] = useState(!isWorker)
  const [supplierMap, setSupplierMap] = useState<Record<string, Supplier>>({})
  const [bankByPurchase, setBankByPurchase] = useState<Record<string, BankTransaction[]>>({})

  useEffect(() => {
    setItems([emptyItem()])
  }, [])

  const refreshLookups = () => {
    supplierService.getAll().then(all => {
      setSuppliers(all.filter(s => s.status === 'active'))
      const map: Record<string, Supplier> = {}
      all.forEach(s => { map[s.id] = s })
      setSupplierMap(map)
    })
    materialService.getAll().then(all => {
      const active = all.filter(m => m.status === 'active')
      materialsRef.current = active
      setMaterials(active)
    })
  }

  const loadHistory = useCallback(() => {
    if (isWorker) {
      setHistory([])
      setHistoryLoading(false)
      return
    }
    setHistoryLoading(true)
    purchaseService
      .getAll()
      .then(async rows => {
        setHistory(rows)
        const bankRows = await bankService.getAll({ max: 500 }).catch(() => [] as BankTransaction[])
        const map: Record<string, BankTransaction[]> = {}
        for (const t of bankRows) {
          if (!t.purchaseId) continue
          if (!map[t.purchaseId]) map[t.purchaseId] = []
          map[t.purchaseId].push(t)
        }
        setBankByPurchase(map)
      })
      .finally(() => setHistoryLoading(false))
  }, [isWorker])

  useEffect(() => { loadHistory() }, [loadHistory])

  const updateItem = (index: number, patch: Partial<LineItem>) => {
    setItems(prev => prev.map((item, i) => i === index ? { ...item, ...patch } : item))
  }

  const defaultsFromMaterial = (mat?: Material | null): Pick<LineItem, 'unitCost' | 'gstRate'> => ({
    gstRate: Number(mat?.gstRate ?? 0),
    unitCost: Number(mat?.costPerUnit ?? 0),
  })

  const setMaterial = (index: number, materialId: string, matOverride?: Material) => {
    const mat = matOverride ?? materialsRef.current.find(m => m.id === materialId) ?? materials.find(m => m.id === materialId)
    updateItem(index, { materialId, ...defaultsFromMaterial(mat) })
  }

  useEffect(() => { refreshLookups() }, [])

  useEffect(() => {
    if (user?.uid) setPurchasedById(prev => prev || user.uid)
  }, [user])

  useEffect(() => {
    let cancelled = false
    const self = (): PurchaserOption | null => {
      if (!user || !userDoc) return null
      return {
        id: user.uid,
        name: userDoc.name?.trim() || user.email || 'You',
        email: userDoc.email || user.email || '',
        role: userDoc.role,
      }
    }
    usersService.listActive()
      .then(list => {
        if (!cancelled) setPurchasers(list)
      })
      .catch(() => {
        const me = self()
        if (!cancelled && me) setPurchasers([me])
      })
    return () => { cancelled = true }
  }, [user, userDoc])

  const purchaserOptions = useMemo(() => {
    const list = [...purchasers]
    if (user && userDoc && !list.some(u => u.id === user.uid)) {
      list.push({
        id: user.uid,
        name: userDoc.name?.trim() || user.email || 'You',
        email: userDoc.email || user.email || '',
        role: userDoc.role,
      })
    }
    return list.sort((a, b) => a.name.localeCompare(b.name))
  }, [purchasers, user, userDoc])

  useEffect(() => {
    if (!materials.length) return
    setItems(prev => prev.map(item => {
      if (!item.materialId) return item
      if (item.unitCost !== 0 || item.gstRate !== 0) return item
      const mat = materials.find(m => m.id === item.materialId)
      if (!mat) return item
      if (!(Number(mat.costPerUnit) || Number(mat.gstRate))) return item
      return { ...item, ...defaultsFromMaterial(mat) }
    }))
  }, [materials])

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const taxLines = items.map(i => lineTax(parseFloat(i.quantity) || 0, i.unitCost, i.gstRate))
  const taxableSubtotal = taxLines.reduce((s, l) => s + l.taxableAmount, 0)
  const gstTotal = taxLines.reduce((s, l) => s + l.gstAmount, 0)
  const grandTotal = taxableSubtotal + gstTotal
  const canSubmit = supplierId && purchasedById && items.length > 0 && items.every(i => i.materialId && parseFloat(i.quantity) > 0)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    try {
      const ts = Timestamp.fromDate(new Date(purchaseDate))
      const materialMap: Record<string, Material> = {}
      materials.forEach(m => { materialMap[m.id] = m })

      const billPhotoUrls = billPhotos.length
        ? await Promise.all(billPhotos.map(async file => {
            const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
            const sRef = storageRef(storage, `purchases/pending/${tmpId}-${file.name}`)
            await uploadBytes(sRef, file)
            return getDownloadURL(sRef)
          }))
        : []

      const buyer = purchaserOptions.find(u => u.id === purchasedById)
      await purchaseService.complete({
        supplierId,
        purchasedById,
        purchasedByName: buyer?.name || userDoc?.name || '',
        paymentStatus,
        purchaseDate: ts,
        notes,
        billPhotoUrls,
        items: items.map(i => ({
          materialId: i.materialId,
          quantity: parseFloat(i.quantity) || 0,
          unitCost: i.unitCost,
          unit: materialMap[i.materialId]?.unit ?? '',
          gstRate: i.gstRate,
        })),
      })

      showToast('Purchase completed successfully', 'success')
      setSupplierId('')
      setPurchasedById(user?.uid ?? '')
      setPaymentStatus('unpaid')
      setPurchaseDate(nowStr())
      setNotes('')
      setItems([emptyItem()])
      setBillPhotos([])
      if (fileRef.current) fileRef.current.value = ''
      if (!isWorker) loadHistory()
    } catch (err) {
      showToast('Failed to complete purchase', 'danger')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const bankPaidOf = (p: Purchase) =>
    (bankByPurchase[p.id] || []).reduce((s, t) => s + t.amount, 0)

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const openClose = () => {
    const chosen = history.filter(p => selectedIds.includes(p.id) && !purchaseIsPaid(p, bankPaidOf(p)))
    if (!chosen.length) {
      showToast('Select purchases that are still not paid', 'danger')
      return
    }
    const sum = chosen.reduce((s, p) => s + Number(p.grandTotal ?? p.total ?? 0), 0)
    const people = [...new Set(chosen.map(p => p.purchasedByName).filter(Boolean))]
    setClosing({
      ids: chosen.map(p => p.id),
      amount: String(Math.round(sum * 100) / 100),
      occurredAt: nowStr(),
      notes: '',
      label: people.join(', ') || `${chosen.length} purchase${chosen.length === 1 ? '' : 's'}`,
    })
  }

  const handleClose = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!closing || savingCash) return
    const amount = parseFloat(closing.amount)
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter an amount greater than 0', 'danger')
      return
    }
    const occurredAt = new Date(closing.occurredAt)
    if (Number.isNaN(occurredAt.getTime())) {
      showToast('Enter a valid date', 'danger')
      return
    }
    setSavingCash(true)
    try {
      await purchaseService.settleWithCash({
        purchaseIds: closing.ids,
        amount,
        occurredAt,
        notes: closing.notes.trim() || undefined,
        label: closing.label,
      })
      setClosing(null)
      setSelectedIds([])
      showToast('Cash payment recorded and purchases closed', 'success')
      loadHistory()
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to close purchases', 'danger')
      console.error(err)
    } finally {
      setSavingCash(false)
    }
  }

  const lineEditor = (item: LineItem, idx: number) => (
    <>
      <QuickSelect
        label="Material"
        required
        value={item.materialId}
        onChange={id => setMaterial(idx, id)}
        placeholder="Select material…"
        options={materials.map(m => ({ id: m.id, label: `${m.name} (${m.unit})` }))}
        onAdd={() => { setMaterialTarget(idx); setQuick('material') }}
      />
      <div className="mt-2">
        <label className="form-label">Quantity</label>
        <input
          type="number"
          className="form-control"
          min="0"
          step="1"
          value={item.quantity}
          onChange={e => updateItem(idx, { quantity: e.target.value })}
        />
      </div>
      <div className="mt-2">
        <label className="form-label">Unit cost (₹, taxable)</label>
        <input
          type="number"
          className="form-control"
          min={0}
          step="0.01"
          value={item.materialId ? item.unitCost : ''}
          placeholder="0"
          onChange={e => updateItem(idx, { unitCost: parseFloat(e.target.value) || 0 })}
        />
      </div>
      <div className="mt-2">
        <GstRateSelect value={item.gstRate} onChange={rate => updateItem(idx, { gstRate: rate })} />
      </div>
      <div className="mt-2 small text-muted">
        Line: {formatCurrency(taxLines[idx].taxableAmount)} + GST {formatCurrency(taxLines[idx].gstAmount)} = {formatCurrency(taxLines[idx].lineTotal)}
      </div>
    </>
  )

  return (
    <div className="pc-tap">
      <ToastContainer toasts={toasts} />

      <PageHeader
        title="Purchases"
        subtitle="Record what was bought and who paid. Close open purchases later with one cash payment."
        icon="🛒"
        actions={
          !isWorker ? (
            <div className="d-flex gap-2">
              <Link to="/reports?tab=purchases" className="btn btn-outline-secondary btn-sm">Report</Link>
              <Link to="/import?type=purchases" className="btn btn-outline-secondary btn-sm">Import</Link>
            </div>
          ) : undefined
        }
      />

      <div className="card mb-4">
        <div className="card-header">
          <h5 className="mb-0">New Purchase</h5>
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3 mb-3">
              <div className="col-md-3">
                <QuickSelect
                  label="Supplier"
                  required
                  value={supplierId}
                  onChange={setSupplierId}
                  placeholder="Select supplier…"
                  options={suppliers.map(s => ({ id: s.id, label: s.name }))}
                  onAdd={() => setQuick('supplier')}
                />
              </div>
              <div className="col-md-3">
                <QuickSelect
                  label="Paid by"
                  required
                  value={purchasedById}
                  onChange={setPurchasedById}
                  placeholder="Select who paid…"
                  options={purchaserOptions.map(u => ({
                    id: u.id,
                    label: `${u.name} · ${ROLE_LABELS[u.role]}`,
                  }))}
                />
              </div>
              <div className="col-md-3">
                <label className="form-label">Payment status <span className="text-danger">*</span></label>
                <select
                  className="form-select"
                  value={paymentStatus}
                  onChange={e => setPaymentStatus(e.target.value === 'paid' ? 'paid' : 'unpaid')}
                >
                  <option value="unpaid">Not paid</option>
                  <option value="paid">Paid</option>
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
              </div>
            </div>

            <h6 className="mb-2">Line Items</h6>
            <div className="d-none d-lg-block table-responsive mb-2">
              <table className="table table-sm table-bordered align-middle">
                <thead className="table-light">
                  <tr>
                    <th>Material</th>
                    <th style={{ width: '100px' }}>Qty</th>
                    <th style={{ width: '120px' }}>Unit cost</th>
                    <th style={{ width: '110px' }}>GST</th>
                    <th style={{ width: '120px' }}>Line</th>
                    <th style={{ width: '50px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx}>
                      <td>
                        <div className="d-flex gap-1">
                          <select className="form-select form-select-sm" value={item.materialId} onChange={e => setMaterial(idx, e.target.value)}>
                            <option value="">Select…</option>
                            {materials.map(m => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}
                          </select>
                          <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => { setMaterialTarget(idx); setQuick('material') }}>+</button>
                        </div>
                      </td>
                      <td>
                        <input type="number" className="form-control form-control-sm" min="0" value={item.quantity} onChange={e => updateItem(idx, { quantity: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" className="form-control form-control-sm" min={0} step="0.01" value={item.materialId ? item.unitCost : ''} placeholder="0" onChange={e => updateItem(idx, { unitCost: parseFloat(e.target.value) || 0 })} />
                      </td>
                        <td>
                          <GstRateSelect
                            label={null}
                            compact
                            className="form-select form-select-sm"
                            value={item.gstRate}
                            onChange={rate => updateItem(idx, { gstRate: rate })}
                          />
                        </td>
                      <td>{formatCurrency(taxLines[idx].lineTotal)}</td>
                      <td>
                        <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeItem(idx)} disabled={items.length === 1}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="d-lg-none pc-line-cards">
              {items.map((item, idx) => (
                <div key={idx} className="pc-line-card mb-2">
                  <div className="d-flex justify-content-between mb-2">
                    <strong>Item {idx + 1}</strong>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeItem(idx)} disabled={items.length === 1}>Remove</button>
                  </div>
                  {lineEditor(item, idx)}
                </div>
              ))}
            </div>

            <div className="d-flex align-items-center justify-content-between mb-3 flex-wrap gap-2">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setItems(prev => [...prev, emptyItem()])}>
                + Add Item
              </button>
              <div className="text-end">
                <div className="small text-muted">Taxable {formatCurrency(taxableSubtotal)} · GST {formatCurrency(gstTotal)}</div>
                <div className="fw-bold">Grand total {formatCurrency(grandTotal)}</div>
              </div>
            </div>

            <div className="pc-sticky-submit">
              <button type="submit" className="btn btn-primary w-100 w-lg-auto" disabled={!canSubmit || submitting}>
                {submitting ? 'Processing…' : 'Complete Purchase'}
              </button>
            </div>
          </form>
        </div>
      </div>

      <EntityQuickCreate
        kind={quick === 'material' ? 'material' : 'supplier'}
        show={quick !== null}
        onCancel={() => setQuick(null)}
        onCreated={created => {
          if (created.kind === 'supplier') {
            setSuppliers(prev => [...prev, created.entity])
            setSupplierMap(prev => ({ ...prev, [created.entity.id]: created.entity }))
            setSupplierId(created.entity.id)
          } else if (created.kind === 'material') {
            materialsRef.current = [...materialsRef.current, created.entity]
            setMaterials(prev => [...prev, created.entity])
            setMaterial(materialTarget, created.entity.id, created.entity)
          }
          setQuick(null)
        }}
      />

      {!isWorker && (
        <div className="card">
          <div className="card-header d-flex justify-content-between align-items-center gap-2">
            <h5 className="mb-0">Purchase History</h5>
            {canRecordCash && selectedIds.length > 0 && (
              <button type="button" className="btn btn-sm btn-primary" onClick={openClose}>
                Close {selectedIds.length} with cash
              </button>
            )}
          </div>
          <div className="card-body p-0">
            {historyLoading ? (
              <div className="p-3"><LoadingSpinner /></div>
            ) : (
              <DataGrid
                items={history}
                empty={
                  <div className="p-3">
                    <EmptyState
                      icon="🛒"
                      message="No purchases yet"
                      description="Log your first purchase above, or snap the bill and let the assistant read it."
                    />
                  </div>
                }
              >
                {pageItems => (
                  <>
                    <thead className="table-light">
                      <tr>
                        {canRecordCash && <th style={{ width: 36 }}></th>}
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Paid by</th>
                        <th>Materials</th>
                        <th>Total Qty</th>
                        <th>Total (₹)</th>
                        <th>Payment</th>
                        <th>Bills</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map(p => {
                        const total = Number(p.grandTotal ?? p.total ?? 0)
                        const settled = purchaseIsPaid(p, bankPaidOf(p))
                        return (
                        <tr key={p.id}>
                          {canRecordCash && (
                            <td>
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={selectedIds.includes(p.id)}
                                disabled={settled || p.status !== 'COMPLETED'}
                                onChange={() => toggleSelected(p.id)}
                                aria-label={`Select purchase from ${supplierMap[p.supplierId]?.name ?? 'supplier'}`}
                              />
                            </td>
                          )}
                          <td>{formatDate(p.purchaseDate)}</td>
                          <td>{supplierMap[p.supplierId]?.name ?? p.supplierId}</td>
                          <td>{p.purchasedByName || '—'}</td>
                          <td>{p.itemCount ?? '—'}</td>
                          <td>{p.totalQty ?? '—'}</td>
                          <td>{formatCurrency(total)}</td>
                          <td>
                            <span className={`badge ${settled ? 'text-bg-success' : 'text-bg-warning'}`}>
                              {settled ? 'Paid' : 'Not paid'}
                            </span>
                          </td>
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
                        )
                      })}
                    </tbody>
                  </>
                )}
              </DataGrid>
            )}
          </div>
        </div>
      )}

      {closing && (
        <>
          <div className="modal-backdrop fade show" onClick={() => !savingCash && setClosing(null)} />
          <div className="modal d-block" tabIndex={-1} onClick={() => !savingCash && setClosing(null)}>
            <div className="modal-dialog modal-dialog-centered" onClick={e => e.stopPropagation()}>
              <form className="modal-content" onSubmit={e => void handleClose(e)}>
                <div className="modal-header">
                  <h5 className="modal-title">Close {closing.ids.length} purchase{closing.ids.length === 1 ? '' : 's'} with cash</h5>
                  <button type="button" className="btn-close" disabled={savingCash} onClick={() => setClosing(null)} />
                </div>
                <div className="modal-body">
                  <p className="small text-muted mb-3">
                    This records the cash you handed over to settle {closing.label}. Those purchases are marked paid.
                  </p>
                  <div className="mb-2">
                    <label className="form-label">Amount (₹)</label>
                    <input
                      type="number"
                      className="form-control"
                      min={0}
                      step="0.01"
                      value={closing.amount}
                      disabled={savingCash}
                      onChange={e => setClosing(prev => prev ? { ...prev, amount: e.target.value } : prev)}
                      required
                    />
                  </div>
                  <div className="mb-2">
                    <label className="form-label">Paid on</label>
                    <input
                      type="datetime-local"
                      className="form-control"
                      value={closing.occurredAt}
                      disabled={savingCash}
                      onChange={e => setClosing(prev => prev ? { ...prev, occurredAt: e.target.value } : prev)}
                      required
                    />
                  </div>
                  <div>
                    <label className="form-label">Note</label>
                    <input
                      type="text"
                      className="form-control"
                      value={closing.notes}
                      disabled={savingCash}
                      placeholder="Optional"
                      onChange={e => setClosing(prev => prev ? { ...prev, notes: e.target.value } : prev)}
                    />
                  </div>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-outline-secondary" disabled={savingCash} onClick={() => setClosing(null)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={savingCash}>
                    {savingCash ? 'Saving…' : 'Record cash and close'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </>
      )}

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
                  <img src={viewingBills[viewingIdx]} alt={`Bill ${viewingIdx + 1}`} className="img-fluid rounded" style={{ maxHeight: '70vh', objectFit: 'contain' }} />
                </div>
                {viewingBills.length > 1 && (
                  <div className="modal-footer justify-content-center gap-2">
                    <button className="btn btn-outline-secondary btn-sm" disabled={viewingIdx === 0} onClick={() => setViewingIdx(i => i - 1)}>← Prev</button>
                    <span className="text-muted small">{viewingIdx + 1} / {viewingBills.length}</span>
                    <button className="btn btn-outline-secondary btn-sm" disabled={viewingIdx === viewingBills.length - 1} onClick={() => setViewingIdx(i => i + 1)}>Next →</button>
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
