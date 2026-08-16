import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { storage } from '../../firebase/config'
import { supplierService } from '../../services/suppliers'
import { Supplier } from '../../types'
import LoadingSpinner from '../../components/LoadingSpinner'
import EmptyState from '../../components/EmptyState'
import ConfirmModal from '../../components/ConfirmModal'
import { useToast } from '../../hooks/useToast'
import ToastContainer from '../../components/ToastContainer'
import { exportToCSV } from '../../utils/export'
import { useAuth } from '../../hooks/useAuth'

interface FormData {
  type: 'individual' | 'company'
  name: string
  companyName: string
  contactPerson: string
  phone: string
  email: string
  address: string
  city: string
  notes: string
  mapLink: string
}

function SupplierForm({
  initial,
  onSave,
  onCancel,
  saving,
}: {
  initial?: Partial<Supplier>
  onSave: (data: FormData, photos: File[]) => Promise<void>
  onCancel: () => void
  saving: boolean
}) {
  const [form, setForm] = useState<FormData>({
    type: initial?.type ?? 'individual',
    name: initial?.name ?? '',
    companyName: initial?.companyName ?? '',
    contactPerson: initial?.contactPerson ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    address: initial?.address ?? '',
    city: initial?.city ?? '',
    notes: initial?.notes ?? '',
    mapLink: initial?.mapLink ?? '',
  })
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  const set = (field: keyof FormData) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setSelectedPhotos(Array.from(e.target.files))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    await onSave(form, selectedPhotos)
  }

  const isCompany = form.type === 'company'

  return (
    <form onSubmit={handleSubmit}>
      <div className="modal-body">
        <div className="mb-3">
          <label className="form-label">Supplier Type <span className="text-danger">*</span></label>
          <div className="d-flex gap-3">
            <div className="form-check">
              <input className="form-check-input" type="radio" id="stype-individual"
                checked={form.type === 'individual'}
                onChange={() => setForm(f => ({ ...f, type: 'individual' }))} />
              <label className="form-check-label" htmlFor="stype-individual">Individual</label>
            </div>
            <div className="form-check">
              <input className="form-check-input" type="radio" id="stype-company"
                checked={form.type === 'company'}
                onChange={() => setForm(f => ({ ...f, type: 'company' }))} />
              <label className="form-check-label" htmlFor="stype-company">Company</label>
            </div>
          </div>
        </div>

        {isCompany ? (
          <>
            <div className="mb-3">
              <label className="form-label">Company Name <span className="text-danger">*</span></label>
              <input className="form-control" value={form.companyName} onChange={set('companyName')} required={isCompany} />
            </div>
            <div className="mb-3">
              <label className="form-label">Contact Person <span className="text-danger">*</span></label>
              <input className="form-control" value={form.contactPerson} onChange={set('contactPerson')} required={isCompany} />
            </div>
          </>
        ) : (
          <div className="mb-3">
            <label className="form-label">Name <span className="text-danger">*</span></label>
            <input className="form-control" value={form.name} onChange={set('name')} required={!isCompany} />
          </div>
        )}

        <div className="mb-3">
          <label className="form-label">Phone</label>
          <input className="form-control" value={form.phone} onChange={set('phone')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input className="form-control" type="email" value={form.email} onChange={set('email')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Address</label>
          <input className="form-control" value={form.address} onChange={set('address')} />
        </div>
        <div className="mb-3">
          <label className="form-label">City</label>
          <input className="form-control" value={form.city} onChange={set('city')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Google Maps Link</label>
          <input className="form-control" placeholder="Paste a Google Maps URL or lat,lng" value={form.mapLink} onChange={set('mapLink')} />
        </div>
        <div className="mb-3">
          <label className="form-label">Photos</label>
          <input ref={fileRef} type="file" accept="image/*" multiple className="form-control" onChange={handleFileChange} />
          {selectedPhotos.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mt-2">
              {selectedPhotos.map(f => (
                <span key={f.name} className="badge bg-secondary">{f.name}</span>
              ))}
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

function displayName(s: Supplier): string {
  return s.type === 'company' ? (s.companyName ?? s.name) : s.name
}

export default function SupplierList() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<Supplier | null>(null)
  const [saving, setSaving] = useState(false)
  const { toasts, showToast } = useToast()
  const { role } = useAuth()
  const isWorker = role === 'worker'

  const load = async () => {
    try {
      setLoading(true)
      setSuppliers(await supplierService.getAll())
    } catch {
      showToast('Failed to load suppliers', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = suppliers.filter(s => {
    const q = search.toLowerCase()
    return (
      displayName(s).toLowerCase().includes(q) ||
      (s.contactPerson ?? '').toLowerCase().includes(q) ||
      s.email.toLowerCase().includes(q) ||
      s.phone.toLowerCase().includes(q)
    )
  })

  const buildPayload = (data: FormData) => {
    if (data.type === 'company') {
      return {
        type: 'company' as const,
        name: data.contactPerson,
        companyName: data.companyName,
        contactPerson: data.contactPerson,
        phone: data.phone, email: data.email,
        address: data.address, city: data.city,
        notes: data.notes, mapLink: data.mapLink,
      }
    }
    return {
      type: 'individual' as const,
      name: data.name,
      companyName: '', contactPerson: '',
      phone: data.phone, email: data.email,
      address: data.address, city: data.city,
      notes: data.notes, mapLink: data.mapLink,
    }
  }

  const uploadPhotos = async (supplierId: string, files: File[], existing: string[] = []): Promise<string[]> => {
    if (!files.length) return existing
    const urls = await Promise.all(files.map(async file => {
      const storageRef = ref(storage, `suppliers/${supplierId}/${Date.now()}-${file.name}`)
      await uploadBytes(storageRef, file)
      return getDownloadURL(storageRef)
    }))
    return [...existing, ...urls]
  }

  const handleAdd = async (data: FormData, photos: File[]) => {
    setSaving(true)
    try {
      const id = await supplierService.create({ ...buildPayload(data), status: 'active' })
      if (photos.length) {
        const photoUrls = await uploadPhotos(id, photos)
        await supplierService.update(id, { photoUrls })
      }
      showToast('Supplier added')
      setShowForm(false)
      await load()
    } catch {
      showToast('Failed to add supplier', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleEdit = async (data: FormData, photos: File[]) => {
    if (!editSupplier) return
    setSaving(true)
    try {
      const payload = buildPayload(data)
      let photoUrls = editSupplier.photoUrls ?? []
      if (photos.length) photoUrls = await uploadPhotos(editSupplier.id, photos, photoUrls)
      await supplierService.update(editSupplier.id, { ...payload, photoUrls })
      showToast('Supplier updated')
      setEditSupplier(null)
      await load()
    } catch {
      showToast('Failed to update supplier', 'danger')
    } finally {
      setSaving(false)
    }
  }

  const handleToggle = async () => {
    if (!confirmToggle) return
    try {
      await supplierService.toggleStatus(confirmToggle.id, confirmToggle.status)
      showToast(`Supplier ${confirmToggle.status === 'active' ? 'deactivated' : 'activated'}`)
      setConfirmToggle(null)
      await load()
    } catch {
      showToast('Failed to update status', 'danger')
    }
  }

  const handleExport = () => {
    exportToCSV(filtered.map(s => ({
      type: s.type,
      name: displayName(s),
      contactPerson: s.contactPerson ?? '',
      phone: s.phone,
      email: s.email,
      address: s.address,
      city: s.city,
      status: s.status,
    })), 'suppliers')
  }

  const openAdd = () => { setShowForm(true); setEditSupplier(null) }
  const openEdit = (s: Supplier) => { setEditSupplier(s); setShowForm(false) }
  const closeModal = () => { setShowForm(false); setEditSupplier(null) }
  const showModal = showForm || editSupplier !== null

  return (
    <div className="container-fluid py-3">
      <ToastContainer toasts={toasts} />

      <div className="d-flex justify-content-between align-items-center mb-3">
        <h4 className="mb-0">Suppliers</h4>
        <div className="d-flex gap-2">
          {!isWorker && <button className="btn btn-outline-secondary btn-sm" onClick={handleExport}>Export CSV</button>}
          <button className="btn btn-primary btn-sm" onClick={openAdd}>+ Add Supplier</button>
        </div>
      </div>

      <div className="mb-3">
        <input className="form-control" placeholder="Search by name, email, or phone…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <EmptyState message={search ? 'No suppliers match your search.' : 'No suppliers yet. Add your first supplier!'} />
      ) : (
        <div className="table-responsive">
          <table className="table table-hover align-middle">
            <thead className="table-light">
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>Phone</th>
                <th>Email</th>
                <th>City</th>
                <th>Status</th>
                {!isWorker && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {filtered.map(s => (
                <tr key={s.id}>
                  <td>
                    <Link to={`/suppliers/${s.id}`} className="fw-semibold text-decoration-none">
                      {displayName(s)}
                    </Link>
                    {s.type === 'company' && s.contactPerson && (
                      <div className="text-muted small">{s.contactPerson}</div>
                    )}
                  </td>
                  <td>
                    <span className={`badge bg-${s.type === 'company' ? 'info' : 'secondary'} text-dark`}>
                      {s.type === 'company' ? 'Company' : 'Individual'}
                    </span>
                  </td>
                  <td>{s.phone || '—'}</td>
                  <td>{s.email || '—'}</td>
                  <td>{s.city || '—'}</td>
                  <td>
                    <span className={`badge bg-${s.status === 'active' ? 'success' : 'secondary'}`}>
                      {s.status}
                    </span>
                  </td>
                  {!isWorker && (
                    <td>
                      <div className="d-flex gap-2">
                        <button className="btn btn-sm btn-outline-primary" onClick={() => openEdit(s)}>Edit</button>
                        <button
                          className={`btn btn-sm btn-outline-${s.status === 'active' ? 'warning' : 'success'}`}
                          onClick={() => setConfirmToggle(s)}
                        >
                          {s.status === 'active' ? 'Deactivate' : 'Activate'}
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showModal && (
        <>
          <div className="modal-backdrop fade show" />
          <div className="modal d-block" tabIndex={-1}>
            <div className="modal-dialog">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title">{editSupplier ? 'Edit Supplier' : 'Add Supplier'}</h5>
                  <button className="btn-close" onClick={closeModal} />
                </div>
                <SupplierForm
                  initial={editSupplier ?? undefined}
                  onSave={editSupplier ? handleEdit : handleAdd}
                  onCancel={closeModal}
                  saving={saving}
                />
              </div>
            </div>
          </div>
        </>
      )}

      <ConfirmModal
        show={confirmToggle !== null}
        title={confirmToggle?.status === 'active' ? 'Deactivate Supplier' : 'Activate Supplier'}
        message={
          confirmToggle
            ? confirmToggle.status === 'active'
              ? `Deactivate ${displayName(confirmToggle)}?`
              : `Activate ${displayName(confirmToggle)}?`
            : ''
        }
        confirmLabel={confirmToggle?.status === 'active' ? 'Deactivate' : 'Activate'}
        onConfirm={handleToggle}
        onCancel={() => setConfirmToggle(null)}
      />
    </div>
  )
}
