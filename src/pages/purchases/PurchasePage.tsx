import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Timestamp } from 'firebase/firestore'
import { Link } from 'react-router-dom'
import { ref as storageRef, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { purchaseService, pricePurchase } from '../../services/purchases'
import { usersService } from '../../services/users'
import { supplierService } from '../../services/suppliers'
import { materialService } from '../../services/materials'
import { formatCurrency, formatDate } from '../../utils/format'
import { useToast } from '../../hooks/useToast'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import PageHeader from '../../components/PageHeader'
import DataGrid from '../../components/DataGrid'
import ToastContainer from '../../components/ToastContainer'
import ConfirmModal from '../../components/ConfirmModal'
import QuickSelect, { SearchSelect } from '../../components/QuickSelect'
import EntityQuickCreate from '../../components/EntityQuickCreate'
import { GstRateSelect } from '../../components/GstFields'
import type { Purchase, Supplier, Material, UserRole, WorkerOption } from '../../types'
import { useAuth } from '../../hooks/useAuth'
import { isAdminOrOwner, isWorker as roleIsWorker, ROLE_LABELS } from '../../utils/roles'

interface LineItem {
  kind: 'material' | 'charge'
  /** Charge label, e.g. "Porter delivery" */
  description: string
  materialId: string
  quantity: string
  unitCost: number
  gstRate: number
}

const nowStr = () => {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const toLocalInput = (ts?: Timestamp | null) => {
  const d = ts?.toDate?.() ?? new Date()
  if (Number.isNaN(d.getTime())) return nowStr()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const emptyItem = (gstRate = 0): LineItem => ({ kind: 'material', description: '', materialId: '', quantity: '1', unitCost: 0, gstRate })
const emptyCharge = (): LineItem => ({ kind: 'charge', description: '', materialId: '', quantity: '1', unitCost: 0, gstRate: 0 })

const CHARGE_SUGGESTIONS = ['Porter delivery', 'DTDC courier', 'Rapido delivery', 'Transport', 'Loading / unloading']

type PurchaserOption = WorkerOption & { role: UserRole }

export default function PurchasePage() {
  const { toasts, showToast } = useToast()
  const { user, userDoc, role } = useAuth()
  const isWorker = roleIsWorker(role)
  const canManage = isAdminOrOwner(role)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [materials, setMaterials] = useState<Material[]>([])
  const [purchasers, setPurchasers] = useState<PurchaserOption[]>([])
  const [supplierId, setSupplierId] = useState('')
  const [purchasedById, setPurchasedById] = useState('')
  const [purchaseDate, setPurchaseDate] = useState(nowStr())
  const [notes, setNotes] = useState('')
  const [items, setItems] = useState<LineItem[]>([emptyItem()])
  const [billPhotos, setBillPhotos] = useState<File[]>([])
  const [existingBillUrls, setExistingBillUrls] = useState<string[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [loadingEdit, setLoadingEdit] = useState(false)
  const [deleting, setDeleting] = useState<Purchase | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const [quick, setQuick] = useState<'supplier' | 'material' | null>(null)
  const [materialTarget, setMaterialTarget] = useState(0)
  const materialsRef = useRef<Material[]>([])

  const [viewingBills, setViewingBills] = useState<string[] | null>(null)
  const [viewingIdx, setViewingIdx] = useState(0)

  const [history, setHistory] = useState<Purchase[]>([])
  const [historyLoading, setHistoryLoading] = useState(!isWorker)
  const [supplierMap, setSupplierMap] = useState<Record<string, Supplier>>({})

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
      .then(setHistory)
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

  const materialOptions = useMemo(
    () => [...materials]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(m => ({ id: m.id, label: `${m.name}${m.colorSpec?.trim() ? ` · ${m.colorSpec.trim()}` : ''} (${m.unit})` })),
    [materials],
  )

  const removeItem = (index: number) => {
    setItems(prev => prev.filter((_, i) => i !== index))
  }

  const { taxLines, taxableSubtotal, gstTotal, chargesTotal, grandTotal } = pricePurchase(
    items.map(i => ({ kind: i.kind, quantity: parseFloat(i.quantity) || 0, unitCost: i.unitCost, gstRate: i.gstRate })),
  )
  const lineReady = (i: LineItem) =>
    parseFloat(i.quantity) > 0 && (i.kind === 'charge' ? Boolean(i.description.trim()) && i.unitCost > 0 : Boolean(i.materialId))
  const canSubmit = supplierId && purchasedById && items.some(i => i.kind === 'material') && items.every(lineReady)
  const formRef = useRef<HTMLDivElement>(null)

  const resetForm = () => {
    setEditingId(null)
    setSupplierId('')
    setPurchasedById(user?.uid ?? '')
    setPurchaseDate(nowStr())
    setNotes('')
    setItems([emptyItem()])
    setBillPhotos([])
    setExistingBillUrls([])
    if (fileRef.current) fileRef.current.value = ''
  }

  const startEdit = async (p: Purchase) => {
    setLoadingEdit(true)
    try {
      const lines = await purchaseService.getItems(p.id)
      setEditingId(p.id)
      setSupplierId(p.supplierId)
      setPurchasedById(p.purchasedById || '')
      setPurchaseDate(toLocalInput(p.purchaseDate))
      setNotes(p.notes || '')
      setExistingBillUrls(p.billPhotoUrls ?? [])
      setBillPhotos([])
      if (fileRef.current) fileRef.current.value = ''
      const loaded: LineItem[] = lines.map(line => ({
        kind: line.kind === 'charge' ? 'charge' : 'material',
        description: line.description ?? '',
        materialId: line.materialId,
        quantity: String(line.quantity),
        unitCost: Number(line.unitCost ?? 0),
        gstRate: Number(line.gstRate ?? 0),
      }))
      loaded.sort((a, b) => Number(a.kind === 'charge') - Number(b.kind === 'charge'))
      const legacy = p.logistics
      if (legacy && Number(legacy.amount) > 0) {
        loaded.push({
          ...emptyCharge(),
          description: ['Delivery', legacy.mode?.trim()].filter(Boolean).join(' · '),
          unitCost: Number(legacy.amount),
          gstRate: Number(legacy.gstRate ?? 0),
        })
      }
      setItems(loaded.length ? loaded : [emptyItem()])
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    } catch (err) {
      showToast('Could not open this purchase', 'danger')
      console.error(err)
    } finally {
      setLoadingEdit(false)
    }
  }

  const handleDelete = async () => {
    if (!deleting) return
    try {
      await purchaseService.delete(deleting.id)
      if (editingId === deleting.id) resetForm()
      showToast('Purchase deleted and stock reversed', 'success')
      setDeleting(null)
      loadHistory()
    } catch (err) {
      showToast('Failed to delete purchase', 'danger')
      console.error(err)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!canSubmit || submitting) return

    setSubmitting(true)
    try {
      const ts = Timestamp.fromDate(new Date(purchaseDate))
      const materialMap: Record<string, Material> = {}
      materials.forEach(m => { materialMap[m.id] = m })

      const uploaded = billPhotos.length
        ? await Promise.all(billPhotos.map(async file => {
            const tmpId = `${Date.now()}-${Math.random().toString(36).slice(2)}`
            const sRef = storageRef(storage, `purchases/${editingId ?? 'pending'}/${tmpId}-${file.name}`)
            await uploadBytes(sRef, file)
            return getDownloadURL(sRef)
          }))
        : []
      const billPhotoUrls = [...existingBillUrls, ...uploaded]

      const buyer = purchaserOptions.find(u => u.id === purchasedById)
      const payload = {
        supplierId,
        purchasedById,
        purchasedByName: buyer?.name || userDoc?.name || '',
        purchaseDate: ts,
        notes,
        billPhotoUrls,
        items: items.map(i => ({
          kind: i.kind,
          description: i.description,
          materialId: i.kind === 'charge' ? '' : i.materialId,
          quantity: parseFloat(i.quantity) || 0,
          unitCost: i.unitCost,
          unit: i.kind === 'charge' ? '' : (materialMap[i.materialId]?.unit ?? ''),
          gstRate: i.gstRate,
        })),
        updateMaterialCosts: canManage,
      }
      if (editingId) {
        await purchaseService.update(editingId, payload)
        showToast('Purchase updated', 'success')
      } else {
        await purchaseService.complete(payload)
        showToast('Purchase completed successfully', 'success')
      }
      resetForm()
      if (!isWorker) loadHistory()
    } catch (err) {
      showToast(editingId ? 'Failed to update purchase' : 'Failed to complete purchase', 'danger')
      console.error(err)
    } finally {
      setSubmitting(false)
    }
  }

  const lineEditor = (item: LineItem, idx: number) => (
    <>
      {item.kind === 'charge' ? (
        <div>
          <label className="form-label">Charge <span className="text-danger">*</span></label>
          <input
            className="form-control"
            list="charge-suggestions"
            value={item.description}
            onChange={e => updateItem(idx, { description: e.target.value })}
            placeholder="e.g. Porter delivery"
          />
        </div>
      ) : (
        <QuickSelect
          label="Material"
          required
          value={item.materialId}
          onChange={id => setMaterial(idx, id)}
          placeholder="Type to search materials…"
          options={materialOptions}
          onAdd={() => { setMaterialTarget(idx); setQuick('material') }}
          searchable
        />
      )}
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
          value={item.materialId || item.kind === 'charge' ? item.unitCost || '' : ''}
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
        subtitle="Record what was bought and who paid."
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

      <div className="card mb-4" ref={formRef}>
        <div className="card-header d-flex justify-content-between align-items-center">
          <h5 className="mb-0">{editingId ? 'Edit Purchase' : 'New Purchase'}</h5>
          {editingId && (
            <button type="button" className="btn btn-sm btn-outline-secondary" onClick={resetForm} disabled={submitting}>
              Cancel
            </button>
          )}
        </div>
        <div className="card-body">
          <form onSubmit={handleSubmit}>
            <div className="row g-3 mb-3">
              <div className="col-md-6">
                <QuickSelect
                  label="Supplier"
                  required
                  value={supplierId}
                  onChange={setSupplierId}
                  placeholder="Type to search suppliers…"
                  options={[...suppliers].sort((a, b) => a.name.localeCompare(b.name)).map(s => ({ id: s.id, label: s.name }))}
                  onAdd={() => setQuick('supplier')}
                  searchable
                />
              </div>
              <div className="col-md-6">
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
              <div className="col-md-6">
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
                {existingBillUrls.length > 0 && (
                  <div className="d-flex flex-wrap gap-2 mb-2">
                    {existingBillUrls.map((url, i) => (
                      <span key={url} className="badge text-bg-light border">
                        Bill {i + 1}
                        <button
                          type="button"
                          className="btn btn-sm btn-link p-0 ms-1"
                          onClick={() => setExistingBillUrls(prev => prev.filter(u => u !== url))}
                        >
                          Remove
                        </button>
                      </span>
                    ))}
                  </div>
                )}
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
                    <th>Material / charge</th>
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
                        {item.kind === 'charge' ? (
                          <div className="d-flex gap-1 align-items-center">
                            <span className="badge text-bg-warning">Charge</span>
                            <input
                              className="form-control form-control-sm"
                              list="charge-suggestions"
                              value={item.description}
                              onChange={e => updateItem(idx, { description: e.target.value })}
                              placeholder="e.g. Porter delivery"
                            />
                          </div>
                        ) : (
                          <div className="d-flex gap-1">
                            <SearchSelect
                              small
                              value={item.materialId}
                              onChange={id => setMaterial(idx, id)}
                              placeholder="Type to search materials…"
                              options={materialOptions}
                            />
                            <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => { setMaterialTarget(idx); setQuick('material') }}>+</button>
                          </div>
                        )}
                      </td>
                      <td>
                        <input type="number" className="form-control form-control-sm" min="0" value={item.quantity} onChange={e => updateItem(idx, { quantity: e.target.value })} />
                      </td>
                      <td>
                        <input type="number" className="form-control form-control-sm" min={0} step="0.01" value={item.materialId || item.kind === 'charge' ? item.unitCost || '' : ''} placeholder="0" onChange={e => updateItem(idx, { unitCost: parseFloat(e.target.value) || 0 })} />
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
                    <strong>{item.kind === 'charge' ? 'Charge' : 'Item'} {idx + 1}</strong>
                    <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => removeItem(idx)} disabled={items.length === 1}>Remove</button>
                  </div>
                  {lineEditor(item, idx)}
                </div>
              ))}
            </div>

            <div className="d-flex align-items-start justify-content-between mb-3 flex-wrap gap-2">
              <div className="d-flex gap-2 flex-wrap">
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setItems(prev => [...prev, emptyItem()])}>
                  + Add Item
                </button>
                <button type="button" className="btn btn-outline-warning btn-sm" onClick={() => setItems(prev => [...prev, emptyCharge()])}>
                  + Add Charge
                </button>
                <datalist id="charge-suggestions">
                  {CHARGE_SUGGESTIONS.map(c => <option key={c} value={c} />)}
                </datalist>
              </div>
              <div className="text-end">
                <div className="small text-muted">Taxable {formatCurrency(taxableSubtotal)} · GST {formatCurrency(gstTotal)}</div>
                {chargesTotal > 0 && (
                  <div className="small">Materials {formatCurrency(grandTotal - chargesTotal)} · Charges {formatCurrency(chargesTotal)}</div>
                )}
                <div className="fw-bold">Grand total {formatCurrency(grandTotal)}</div>
              </div>
            </div>
            <div className="form-text mb-3">Charges such as delivery are part of the bill only. They do not add stock or change any material's cost.</div>

            <div className="pc-sticky-submit">
              <button type="submit" className="btn btn-primary w-100 w-lg-auto" disabled={!canSubmit || submitting || loadingEdit}>
                {submitting ? 'Processing…' : editingId ? 'Save changes' : 'Complete Purchase'}
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
          <div className="card-header">
            <h5 className="mb-0">Purchase History</h5>
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
                        <th>Date</th>
                        <th>Supplier</th>
                        <th>Paid by</th>
                        <th>Total (₹)</th>
                        <th>Charges</th>
                        <th>Materials</th>
                        <th>Total Qty</th>
                        <th></th>
                        <th>Bills</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageItems.map(p => {
                        const total = Number(p.grandTotal ?? p.total ?? 0)
                        return (
                        <tr key={p.id}>
                          <td>{formatDate(p.purchaseDate)}</td>
                          <td>{supplierMap[p.supplierId]?.name ?? p.supplierId}</td>
                          <td>{p.purchasedByName || '—'}</td>
                          <td>{formatCurrency(total)}</td>
                          <td>
                            {(p.chargesTotal || p.logisticsTotal) ? formatCurrency(Number(p.chargesTotal || 0) + Number(p.logisticsTotal || 0)) : '—'}
                          </td>
                          <td>{p.itemCount ?? '—'}</td>
                          <td>{p.totalQty ?? '—'}</td>
                          <td>
                            {canManage && (
                              <div className="d-flex gap-1">
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-primary"
                                  disabled={loadingEdit}
                                  onClick={() => void startEdit(p)}
                                >
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-sm btn-outline-danger"
                                  onClick={() => setDeleting(p)}
                                >
                                  Delete
                                </button>
                              </div>
                            )}
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

      <ConfirmModal
        show={deleting !== null}
        title="Delete Purchase"
        message={deleting
          ? `Delete the ${formatDate(deleting.purchaseDate)} purchase from ${supplierMap[deleting.supplierId]?.name ?? 'this supplier'}? The stock it added is taken back out.`
          : ''}
        confirmLabel="Delete"
        onConfirm={() => void handleDelete()}
        onCancel={() => setDeleting(null)}
      />

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
