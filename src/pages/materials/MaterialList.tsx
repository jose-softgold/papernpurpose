import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { materialService } from '../../services/materials'
import { inventoryService } from '../../services/inventory'
import { supplierService } from '../../services/suppliers'
import { Material, Supplier, InventoryTransaction } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { exportToCSV } from '../../utils/export'
import { formatCurrency, formatDate } from '../../utils/format'

interface FormData {
  name: string
  category: string
  unit: string
  minimumStock: string
  costPerUnit: string
  supplierId: string
  notes: string
}


function MaterialForm({
  initial,
  suppliers,
  onSave,
  onCancel,
  saving,
  isWorker,
}: {
  initial?: Partial<Material>
  suppliers: Supplier[]
  onSave: (data: FormData, photos: File[]) => Promise<void>
  onCancel: () => void
  saving: boolean
  isWorker?: boolean
}) {
  const [form, setForm] = useState<FormData>({
    name: initial?.name ?? '',
    category: initial?.category ?? '',
    unit: initial?.unit ?? '',
    minimumStock: String(initial?.minimumStock ?? 0),
    costPerUnit: String(initial?.costPerUnit ?? 0),
    supplierId: initial?.supplierId ?? '',
    notes: initial?.notes ?? '',
  })
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (field: keyof FormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm(f => ({ ...f, [field]: e.target.value }))

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave(form, selectedPhotos)
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal-body">
        <div className="mb-3">
          <label className="form-label">Name <span className="text-danger">*</span></label>
          <input className="form-control" value={form.name} onChange={set('name')} required />
        </div>
        <div className="mb-3">
          <label className="form-label">Category</label>
          <input className="form-control" value={form.category} onChange={set('category')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Unit <span className="text-danger">*</span></label>
          <input className="form-control" value={form.unit} onChange={set('unit')} required placeholder="e.g. kg, pcs, m" />
        </div>
        <div className="row">
          <div className="col-md-6 mb-3">
            <label className="form-label">Minimum Stock</label>
            <input className="form-control" type="number" min="0" step="any" value={form.minimumStock} onChange={set('minimumStock')} />
          </div>
          {!isWorker && (
            <div className="col-md-6 mb-3">
              <label className="form-label">Cost/Unit (₹)</label>
              <input className="form-control" type="number" min="0" step="any" value={form.costPerUnit} onChange={set('costPerUnit')} />
            </div>
          )}
        </div>
        {!isWorker && (parseFloat(form.minimumStock) > 0 || parseFloat(form.costPerUnit) > 0) && (
          <div className="alert alert-info py-2 px-3 mb-3">
            <small>
              Min Stock Value:{' '}
              <strong>₹{((parseFloat(form.minimumStock) || 0) * (parseFloat(form.costPerUnit) || 0)).toLocaleString('en-IN')}</strong>
              {' '}({form.minimumStock || 0} {form.unit || 'units'} × ₹{form.costPerUnit || 0})
            </small>
          </div>
        )}
        <div className="mb-3">
          <label className="form-label">Supplier</label>
          <select className="form-select" value={form.supplierId} onChange={set('supplierId')}>
            <option value="">— None —</option>
            {suppliers.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
        <div className="mb-3">
          <label className="form-label">Photos</label>
          <input ref={fileRef} type="file" accept="image/*" multiple className="form-control"
            onChange={e => setSelectedPhotos(e.target.files ? Array.from(e.target.files) : [])} />
          {selectedPhotos.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mt-2">
              {selectedPhotos.map(f => <span key={f.name} className="badge bg-secondary">{f.name}</span>)}
            </div>
          )}
        </div>
        <div className="mb-3">
          <label className="form-label">Notes</label>
          <textarea className="form-control" rows={3} value={form.notes} onChange={set('notes')} />
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  )
}

function TransactionHistoryPanel({
  material,
  transactions,
  loading,
  onClose,
}: {
  material: Material
  transactions: InventoryTransaction[]
  loading: boolean
  onClose: () => void
}) {
  return (
    <div className="card mt-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <span className="fw-semibold">Transaction History — {material.name}</span>
        <button className="btn-close" onClick={onClose} />
      </div>
      <div className="card-body p-0">
        {loading ? (
          <div className="p-3"><LoadingSpinner /></div>
        ) : transactions.length === 0 ? (
          <div className="p-3 text-muted">No transactions recorded for this material.</div>
        ) : (
          <div className="table-responsive">
            <table className="table table-sm mb-0">
              <thead className="table-light">
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th className="text-end">Qty</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.createdAt)}</td>
                    <td><span className="badge bg-secondary">{tx.transactionType}</span></td>
                    <td className={`text-end fw-semibold ${tx.quantity < 0 ? 'text-danger' : 'text-success'}`}>
                      {tx.quantity > 0 ? '+' : ''}{tx.quantity} {tx.unit}
                    </td>
                    <td className="text-muted small">{tx.notes || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function MaterialList() {
  const [materials, setMaterials] = useState<Material[]>([])
  const [stocks, setStocks] = useState<Record<string, number>>({})
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editMaterial, setEditMaterial] = useState<Material | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<Material | null>(null)
  const [saving, setSaving] = useState(false)
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null)
  const [txHistory, setTxHistory] = useState<InventoryTransaction[]>([])
  const [txLoading, setTxLoading] = useState(false)
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const isWorker = role === 'worker'

  const load = async () => {
    try {
      setLoading(true)
      const [mats, stockMap] = await Promise.all([
        materialService.getAll(),
        inventoryService.getMaterialStocks(),
      ])
      setMaterials(mats)
      setStocks(stockMap)
    } catch {
      showToast('Failed to load materials', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    if (!isWorker) supplierService.getAll().then(setSuppliers).catch(() => {})
  }, [])

  const filtered = materials.filter(m => {
    const q = search.toLowerCase()
    return m.name.toLowerCase().includes(q) || m.category.toLowerCase().includes(q)
  })


  const uploadPhotos = async (id: string, files: File[], existing: string[] = []): Promise<string[]> => {
    if (!files.length) return existing
    const urls = await Promise.all(files.map(async file => {
      const storageRef = ref(storage, `materials/${id}/${Date.now()}-${file.name}`)
      await uploadBytes(storageRef, file)
      return getDownloadURL(storageRef)
    }))
    return [...existing, ...urls]
  }

  const handleAdd = async (data: FormData, photos: File[]) => {
    setSaving(true)
    try {
      const id = await materialService.create({
        name: data.name,
        category: data.category,
        unit: data.unit,
        minimumStock: parseFloat(data.minimumStock) || 0,
        costPerUnit: parseFloat(data.costPerUnit) || 0,
        supplierId: data.supplierId,
        notes: data.notes,
        status: 'active',
      })
      if (photos.length) await materialService.update(id, { photoUrls: await uploadPhotos(id, photos) })
      showToast('Material added')
      setShowForm(false)
      await load()
    } catch {
      showToast('Failed to add material', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (data: FormData, photos: File[]) => {
    if (!editMaterial) return
    setSaving(true)
    try {
      let photoUrls = editMaterial.photoUrls ?? []
      if (photos.length) photoUrls = await uploadPhotos(editMaterial.id, photos, photoUrls)
      await materialService.update(editMaterial.id, {
        name: data.name,
        category: data.category,
        unit: data.unit,
        minimumStock: parseFloat(data.minimumStock) || 0,
        costPerUnit: parseFloat(data.costPerUnit) || 0,
        supplierId: data.supplierId,
        notes: data.notes,
        photoUrls,
      })
      showToast('Material updated')
      setEditMaterial(null)
      await load()
    } catch {
      showToast('Failed to update material', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!confirmToggle) return
    try {
      await materialService.update(confirmToggle.id, {
        status: confirmToggle.status === 'active' ? 'inactive' : 'active',
      })
      showToast(`Material ${confirmToggle.status === 'active' ? 'deactivated' : 'activated'}`)
      setConfirmToggle(null)
      await load()
    } catch {
      showToast('Failed to update status', 'danger')
    }
  }

  const handleRowClick = async (m: Material) => {
    if (selectedMaterial?.id === m.id) {
      setSelectedMaterial(null)
      return
    }
    setSelectedMaterial(m)
    setTxLoading(true)
    try {
      const txs = await inventoryService.getTransactions({ itemType: 'material', itemId: m.id })
      setTxHistory(txs)
    } catch {
      showToast('Failed to load transactions', 'danger')
    } finally {
      setTxLoading(false)
    }
  }

  const handleExport = () => {
    const rows = filtered.map(m => ({
      name: m.name,
      category: m.category,
      unit: m.unit,
      minimumStock: m.minimumStock,
      costPerUnit: m.costPerUnit,
      currentStock: stocks[m.id] ?? 0,
    }))
    exportToCSV(rows, 'materials')
  }

  const openAdd = () => { setShowForm(true); setEditMaterial(null) }
  const openEdit = (m: Material, e: React.MouseEvent) => { e.stopPropagation(); setEditMaterial(m); setShowForm(false) }
  const closeModal = () => { setShowForm(false); setEditMaterial(null) }
  const showModal = showForm || editMaterial !== null

  return (
    <div className="container-fluid py-3">
      <ToastContainer toasts={toasts} />

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Materials</h4>
        <div className="d-flex gap-2">
          {!isWorker && <button className="btn btn-outline-secondary btn-sm" onClick={handleExport}>Export CSV</button>}
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Material</button>
        </div>
      </div>

      <div className="mb-3">
        <input
          className="form-control"
          placeholder="Search by name or category…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState message={search ? 'No materials match your search.' : 'No materials yet. Add your first material!'} />
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead className="table-light">
              <tr>
                <th>Material</th>
                <th>Category</th>
                <th className="text-end">Current Stock</th>
                <th>Unit</th>
                <th className="text-end">Min Stock</th>
                {!isWorker && <th className="text-end">Cost/Unit (₹)</th>}
                {!isWorker && <th className="text-end">Stock Value (₹)</th>}
                <th>Status</th>
                {!isWorker && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => {
                const currentStock = stocks[m.id] ?? 0
                const isLow = currentStock < m.minimumStock
                const stockValue = currentStock * m.costPerUnit
                const isSelected = selectedMaterial?.id === m.id
                return (
                  <tr
                    key={m.id}
                    className={`${isLow ? 'table-warning' : ''} ${isSelected ? 'table-active' : ''}`}
                    style={{ cursor: 'pointer' }}
                    onClick={() => handleRowClick(m)}
                  >
                    <td className="fw-semibold">{m.name}</td>
                    <td>{m.category || '—'}</td>
                    <td className="text-end">{currentStock}</td>
                    <td>{m.unit}</td>
                    <td className="text-end">{m.minimumStock}</td>
                    {!isWorker && <td className="text-end">{formatCurrency(m.costPerUnit)}</td>}
                    {!isWorker && <td className="text-end">{formatCurrency(stockValue)}</td>}
                    <td>
                      <span className={`badge bg-${m.status === 'active' ? 'success' : 'secondary'}`}>
                        {m.status}
                      </span>
                    </td>
                    {!isWorker && (
                      <td>
                        <div className="d-flex gap-2">
                          <button
                            className="btn btn-sm btn-outline-primary"
                            onClick={e => openEdit(m, e)}
                          >
                            Edit
                          </button>
                          <button
                            className={`btn btn-sm btn-outline-${m.status === 'active' ? 'warning' : 'success'}`}
                            onClick={e => { e.stopPropagation(); setConfirmToggle(m) }}
                          >
                            {m.status === 'active' ? 'Deactivate' : 'Activate'}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {selectedMaterial && (
        <TransactionHistoryPanel
          material={selectedMaterial}
          transactions={txHistory}
          loading={txLoading}
          onClose={() => setSelectedMaterial(null)}
        />
      )}

      {showModal && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{editMaterial ? 'Edit Material' : 'Add Material'}</h5>
                  <button className="btn-close" onClick={closeModal} />
                </div>
                <MaterialForm
                  initial={editMaterial ?? undefined}
                  suppliers={suppliers}
                  onSave={editMaterial ? handleEdit : handleAdd}
                  onCancel={closeModal}
                  saving={saving}
                  isWorker={isWorker}
                />
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        show={confirmToggle !== null}
        title={confirmToggle?.status === 'active' ? 'Deactivate Material' : 'Activate Material'}
        message={
          confirmToggle?.status === 'active'
            ? `Are you sure you want to deactivate ${confirmToggle?.name}?`
            : `Are you sure you want to activate ${confirmToggle?.name}?`
        }
        confirmLabel={confirmToggle?.status === 'active' ? 'Deactivate' : 'Activate'}
        onConfirm={handleToggle}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  )
}
